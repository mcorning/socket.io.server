//#region express code

const express = require('express');
const path = require('path');

const app = express();

// app.use(express.static(path.join(__dirname, './dist')));

const http = require('http').createServer(app);

app.get('/', (req, res) => {
  res.sendFile('index.html');
});
// app.get('/lct-b', (req, res) => {
//   res.sendFile('dist/lct-b/index.html');
// });

process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error', err);
  process.exit(1); //mandatory (as per the Node.js docs)
});
//#endregion end express code

//#region Socket.io Server initialization
let namespace = '/';
const io = require('socket.io')(http);
// const io = require('socket.io')(server);
// overload to use passed in ID as socket.id
io.engine.generateId = (req) => {
  const parsedUrl = new url.parse(req.url);
  const params = new URLSearchParams(parsedUrl.search);
  const prevId = params.get('id');
  // prevId is either a valid id or an empty string
  if (!!prevId) {
    return prevId;
  }
  return base64id.generateId();
};
// return LCT sockets only
io.use(function (socket, next) {
  if (!socket.handshake.query.id) {
    socket.handshake.query.id = socket.id;
  }
  next();
});

const url = require('url');
const base64id = require('base64id');
const hostname = 'localhost';
const port = process.env.PORT || 3003;

// TODO this needs to be dynamic
let nsp = 'sisters';
//#region Future Use:
// io.set('authorization', function (handshake, callback) {
//   callback(null, handshake._query.id);
// });
const admin = io.of(namespace);
admin.on('connect', (socket) => {
  console.warn('admin socket.id:', socket.id);

  socket.on('message', (data) => console.log(data));
});
//#endregion

//#endregion

//#region RedisGraph setup
const RedisGraph = require('redisgraph.js').Graph;
// TODO options nedds to be dynamic
const options = {
  host: 'redis-11939.c60.us-west-1-2.ec2.cloud.redislabs.com',
  port: 11939,
  password: '7B3DId42aDCtMjmSXg7VN0XZSMOItGAG',
};
const graph = new RedisGraph(nsp, null, null, options);

//#endregion

//#region set up Server Proxy
const { getNow, printJson, logResults, ServerProxy } = require('./radar');
// const S = new ServerProxy(io);

// other utilities
const clc = require('cli-color');
const success = clc.red.green;
const colorExposureAlert = clc.green;
const colorExposureWarning = clc.yellow.red;
const error = clc.red.bold;
const warn = clc.yellow;
const info = clc.cyan;
const notice = clc.blue;
const highlight = clc.magenta;
const bold = clc.bold;

const moment = require('moment');

const { version } = require('./package.json');

function onConnection(query) {
  console.group(
    `EVENT: onConnection [${query.visitor || query.room || query.admin} / ${
      query.id
    }] ${query.closed ? 'Closed' : 'Open'}`
  );
  //let result = S.handlePendings(query);

  console.groupCollapsed('Open Rooms:');
  console.log(printJson(S.openRooms));
  console.groupEnd();

  console.groupCollapsed('Visitors:');
  console.log(printJson(S.visitors));
  console.groupEnd();

  console.groupCollapsed('Available Rooms:');
  console.log(printJson(S.available));
  console.groupEnd();

  console.groupEnd();
  S.exposeOpenRooms();
}

function newSection(text) {
  console.log(
    success(`
[${getNow()}] ${text}`)
  );
}
const S = new ServerProxy(io);

//#endregion setup server proxy

//#region socket.io server code
//=============================================================================//
io.on('connection', (socket) => {
  const query = socket.handshake.query;

  newSection(`Handling a connection to ${socket.id}`);

  if (query.id) {
    if (query.id != socket.id) {
      console.error(`Socket.id ${socket.id} != query.id ${query.id}`);
      return;
    }
    if (query.room && !query.closed) {
      console.groupCollapsed(`[${getNow()}] Reopening ${query.room}`);
      socket.join(query.room);
      console.log('Open Rooms:', printJson(S.exposeOpenRooms()));
      console.groupEnd();
    }
    onConnection(query);
    S.isVisitorPending(query.id);
  } else {
    console.log(error(`Unknown socket ${socket.id}.`));
  }
  //...........................................................................//
  //#region Open/Close Room
  // called by State Machine to bring a Room online
  // so that Visitors can enter
  // this can change the state of io...rooms
  // next step in the pipeline is to access pending Visitor exposure warnings
  const onOpenRoom = (data, ack) => {
    try {
      // const { room, id } = data;
      const { room, id } = socket.handshake.query;

      if (!room) {
        console.log(
          error(
            `${id} is not an LCT Room socket. No further processing possible.`
          )
        );
        return;
      }

      // if Room is already open, return
      if (S.isOpen(id)) {
        console.log(
          `${room} is already open. No further processing necessary.`
        );
        if (ack) {
          ack({
            event: 'onOpenRoom',
            room: data.room,
            state: 'Reopened',
            result: true,
          });
        }
        return;
      }

      // console.log(message, socket.handshake.query);
      console.groupCollapsed(`[${getNow()}] EVENT: onOpenRoom ${data.room}`);

      console.log(`Open Rooms before ${data.room} opens...`);
      console.log(printJson(S.openRooms));
      socket.join(data.room);

      console.log(`...and after ${data.room} opens`);

      console.log(printJson(S.exposeOpenRooms()));
      console.log('Emitted exposeOpenRooms event ');

      console.log('Visitors');
      console.log(printJson(S.visitors));

      // console.log('Available');
      // console.log(printJson(S.available));
      // console.log('Rooms');
      // console.log(printJson(S.openRooms));

      // check for pending warnings
      console.log('...', S.handlePendings(socket.handshake.query));
      // if this checks for connection, why not check Room connected property?
      const assertion = S.roomIdsIncludeSocket(data.room, id);

      console.assert(assertion, `${id} unable to join ${data.room}`);

      if (ack) {
        ack({
          event: 'onOpenRoom',
          room: data.room,
          state: 'Opened',
          result: assertion,
        });
      }
    } catch (error) {
      console.error('Oops, onOpenRoom() hit this:', error.message);
    } finally {
      console.groupEnd();
    }
  };

  // If Room closes, all occupants must leave the Room first
  const onCloseRoom = function (data, ack) {
    try {
      const { room, id, nsp } = data;
      console.group(`[${getNow()}] EVENT: onCloseRoom [${room}]`);

      console.log(`Rooms before ${room} closing...`);
      console.log(printJson(S.openRooms));

      if (S.rooms[room]) {
        console.group('Occupants');
        console.log('Occupants of Room before closing...');
        console.log(printJson(S.rooms[room]));

        Object.keys(S.rooms[room].sockets).forEach((value) => {
          S.getSocket(value).leave(room);
        });

        console.log('...and after Room closing:');
        console.log(printJson(S.rooms[room]));
        console.groupEnd();
      }

      console.log(`...after ${room} closing`);
      console.log(printJson(S.openRooms));
      console.log('Sockets');
      console.log(printJson(S.sockets));
      console.log('Open Rooms');
      console.log(printJson(S.exposeOpenRooms()));
      console.log('Emitted exposeOpenRooms event');

      // if this checks for connection, why not check Room connected property?
      const assertion = !S.roomIdsIncludeSocket(room, id);

      console.assert(assertion, `${id} unable to leave ${room}`);

      if (ack) {
        ack({ event: 'onCloseRoom', room: room, result: assertion });
      }
    } catch (error) {
      console.error('Oops, closeRoom() hit this:', error.message);
    } finally {
      console.groupEnd();
    }
  };
  //#endregion

  //#region Enter/Leave Room
  // Visitor sends this event
  const onEnterRoom = (data, ack) => {
    try {
      const { room, id, nsp, sentTime, visitor } = data;
      console.groupCollapsed(`[${getNow()}] EVENT: onEnterRoom ${room}`);

      // first, ensure the Room is open (note S.rooms returns an object
      // that will include the name of an Open Room after a Room opens its own
      // io room):
      if (!S.rooms[room]) {
        if (ack) {
          ack({
            error: 'Room must be open before you can enter',
            on: 'server.onEnterRoom',
          });
        }
      }

      // Enter the Room. As others enter, you will see a notification they, too, joined.
      socket.join(room);

      //S.roomIdsIncludeSocket essentially calls:
      //const result = io.nsps['/'].adapter.rooms
      // && io.nsps['/'].adapter.rooms[room].sockets[socket.id];
      const assertion = S.roomIdsIncludeSocket(room, socket.id);
      console.assert(assertion, 'Could not enter Room', room);

      // handled by Room.checkIn()
      // sending to individual socketid (private message)
      // this emit assumes the room is open (and not merely connected)
      io.to(room).emit('checkIn', {
        visitor: visitor,
        sentTime: sentTime,
        room: room,
        message: 'Entered',
        socketId: socket.id,
      });

      const occupants = S.getOccupancy(room);
      console.log(warn(`${room} has ${occupants} occupants now:`));
      console.log(printJson(S.rooms[room]));
      if (occupants) {
        if (ack) {
          ack({
            event: 'onEnterRoom',
            room: room,
            occupants: occupants,
            result: assertion,
            emits: 'checkIn',
          });
        }
      } else {
        if (ack) {
          ack({
            event: 'onEnterRoom',
            room: room,
            result: `Could not enter Room ${room}`,
            emits: 'nothing',
          });
        }
      }
    } catch (error) {
      console.error('Oops, onEnterRoom() hit this:', error);
    } finally {
      console.groupEnd();
    }
  };

  const onLeaveRoom = (data, ack) => {
    const { room, visitor, sentTime, message } = data;
    console.groupCollapsed(`[${getNow()}] EVENT: onLeaveRoom ${room}`);
    socket.leave(room);

    // handled by Room.checkOut()
    // sending to individual socketid (private message)
    io.to(room).emit('checkOut', {
      visitor: visitor,
      sentTime: sentTime,
      room: room,
      message: message,
    });

    S.updateOccupancy(room);
    console.log('Visitors:', printJson(S.visitors));

    const msg = `Using their own socket ${socket.id}, ${visitor.visitor} ${
      S.roomIdsIncludeSocket(room, socket.handshake.query.id)
        ? 'did not make it out of'
        : 'made it out of'
    } Room ${room} on ${getNow()}`;

    console.log(warn('leaveRoom():', msg));
    if (ack) {
      console.log('Sending ACK msg to Visitor');
      ack(msg);
    }
    console.groupEnd();
  };

  //#endregion

  //#region Exposure Protocol: Server
  socket.on('stepOneVisitorWarnsRooms', function (data, ack) {
    const { visitor, warningsMap, reason } = data;
    const warnings = new Map(warningsMap);

    console.log(error(`handling: stepOneWarningFromVisitor`));
    console.log(error(`Exposure(s): ${printJson(data)}`));
    let results = [];

    warnings.forEach((exposureDates, room) => {
      console.log(error(`Notifying ${room}`));
      results.push(room);
      const data = {
        room: room,
        reason: reason,
        exposureDates: exposureDates,
        visitor: visitor,
      };

      // in case Room is offline, cache the warning(s)
      S.setPendingVisitorWarning(data);

      // if Room in online, it should handle this event and return a
      // list of exposed visitors Server will handle below
      // using the stepThreeRoomListsVisitorsForServer listener
      S.stepMessage(room, 'stepTwoServerNotifiesRoom', data);
    });

    // ack handled by Visitor in warnRoomCard.vue
    if (ack) {
      ack({
        handler: 'stepOneVisitorWarnsRooms',
        result: results.flat(),
        emits: 'stepTwoServerNotifiesRoom',
      });
    }
  });

  // stepTwoServerNotifiesRoom was handled by Room,
  // and Room then emitted stepThreeRoomListsVisitorsForServer
  // which is acting like an ACK from stepTwoServerNotifiesRoom
  socket.on('stepThreeRoomListsVisitorsForServer', (exposures, ack) => {
    console.log(
      info(
        `Handling stepThreeRoomListsVisitorsForServer: exposedVisitors: ${printJson(
          exposures
        )}`
      )
    );
    const { exposedVisitors, room } = exposures;

    exposedVisitors.forEach((visitor) => {
      const data = {
        visitorId: visitor.id,
        room: room,
      };
      S.setPendingRoomAlerts(data);

      // Final step. This one sent to Visitor
      console.log(error('Handing off to Visitor'));
      console.log(error(printJson(visitor)));
      S.stepMessage(visitor.id, 'stepFourServerAlertsVisitor', {
        exposedVisitor: visitor,
        room: room,
      });
    });
    S.deletePendingVisitorWarning(room, 'stepThreeRoomListsVisitorsForServer');

    // ack handled by Room.vue
    if (ack) {
      ack(exposedVisitors.length);
    }
  });

  // stepThreeRoomListsVisitorsForServer was handled by Visitor,
  // and Visitor then emitted stepFiveVisitorReceivedAlert
  // which is acting like an ACK from stepThreeRoomListsVisitorsForServer
  socket.on('stepFiveVisitorReceivedAlert', (visitorId, ack) => {
    console.log(info(`Handling stepFiveVisitorReceivedAlert for ${visitorId}`));

    S.deletePendingRoomAlerts(visitorId);

    // ack handled by Visitor.vue
    if (ack) {
      ack('Alert deleted on server');
    }
  });
  //#endregion

  // sent by Visitor
  // server handles the Visitor's exposureWarning with a notifyRoom event so Room can take over
  const onLogVisit = (data, ack) => {
    console.log('query:', data);
    graph.query(data).then((results) => {
      const stats = results._statistics._raw;
      console.log(`stats: ${printJson(stats)}`);
      if (ack) {
        ack(stats);
      }
    });
  };

  const onExposureWarning = (data, ack) => {
    try {
      const { visitor, warningsMap, reason } = data;
      console.assert(visitor, 'visitor cannot be empty');
      console.groupCollapsed(
        `[${getNow()}] EVENT: onExposureWarning from [${visitor.visitor}/${
          visitor.id
        }]`
      );
      console.group('Available Rooms:');
      console.log(printJson(S.available));
      console.groupEnd();
      console.group('Open Rooms:');
      console.log(printJson(S.openRooms));
      console.groupEnd();
      console.group('Warning data:');
      console.log(printJson(data));
      console.groupEnd();

      let results = [];

      // warningsMap is serializd, so deserialize in a new Map
      const warnings = new Map(warningsMap);

      console.group('Mapped Warning data:');
      console.log(printJson([...warnings]));
      console.groupEnd();

      // iterate collection notifying each Room separately
      // notifyRoom expects this data:
      // {room, reason, exposureDates, visitor}
      warnings.forEach((exposureDates, room) => {
        results.push(
          S.sendOrPend({
            event: 'notifyRoom',
            room: room,
            reason: reason,
            exposureDates: exposureDates,
            visitor: visitor.id,
          })
        );
      });

      if (ack) {
        ack({
          handler: 'onExposureWarning',
          result: results.flat(),
          emits: 'notifyRoom',
        });
      }
    } catch (error) {
      console.error('onExposureWarning sees:', error);
    } finally {
      console.groupEnd();
    }
  };

  // Room sends this event
  // Server forwards content to Visitor(s) with exposureAlert event sent with alertVisitor handler
  function onAlertVisitor(data, ack) {
    // Visitor message includes the Room names to alert
    try {
      const { message, visitor, room } = data;
      console.groupCollapsed(
        `[${getNow()}] EVENT: onAlertVisitor [${visitor.visitor}/${visitor.id}]`
      );
      if (!message || !visitor) {
        if (ack) {
          ack(
            new error(
              `${
                message ? 'Missing visitor identity' : 'No message to process'
              }`
            )
          );
        }
        return;
      }

      // send or cache the alert
      console.log(`${room} alerting ${visitor.visitor}`);
      data.event = 'exposureAlert';
      let result = S.sendOrPend(data);
      console.groupEnd();

      if (ack) {
        ack(result);
      }
    } catch (error) {
      console.error('ERROR: onAlertVisitor sees:', error);
    } finally {
      console.groupEnd();
    }
  }
  //...........................................................................//

  //#region Socket Events
  //+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++//

  // sent from Visitor
  socket.on('logVisit', onLogVisit);
  // Visitor sends this message:
  // {visitor:{name, id, nsp}, room:{room, id, nsp}, message:{}, sentTime: dateTime}
  // disambiguate enterRoom event from the event handler in the Room, checkIn
  socket.on('enterRoom', onEnterRoom);
  // disambiguate leaveRoom event from the event handler in the Room, checkOut
  socket.on('leaveRoom', onLeaveRoom);
  socket.on('exposureWarning', onExposureWarning);

  // Rooms send these events
  socket.on('openRoom', onOpenRoom); // sent from Room for each visitor
  socket.on('closeRoom', onCloseRoom);
  // (each Visitor warned each Room the date(s) Visitor occupied the Room)
  socket.on('alertVisitor', onAlertVisitor);

  // end Socket Events
  //+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++//
  //#endregion

  //#region  Admin events (for Room managers use)

  socket.on('exposeAllSockets', (data, ack) => {
    if (ack) {
      ack(S.sockets);
    }
  });
  socket.on('exposeOpenRooms', (data, ack) => {
    if (ack) {
      ack(S.exposeOpenRooms());
    }
  });
  socket.on('exposePendingRoomAlerts', (data, ack) => {
    if (ack) {
      ack(S.pendingRoomAlerts);
    }
  });
  socket.on('exposePendingVistorWarnings', (data, ack) => {
    if (ack) {
      ack(S.pendingVisitorWarnings);
    }
  });
  socket.on('exposeAvailableRooms', (data, ack) => {
    if (ack) {
      ack(S.available);
    }
  });
  socket.on('exposeVisitorsRooms', (data, ack) => {
    if (ack) {
      ack(S.visitors);
    }
  });

  socket.on('pingServer', function (data, ack) {
    if (ack) ack(`Server is at your disposal, ${data}`);
  });

  socket.on('disconnect', (reason) => {
    if (
      reason === 'client namespace disconnect' &&
      socket.handshake.query.room
    ) {
      console.log(info('Updating Visitor Open Rooms list'));
      S.exposeOpenRooms();
    }
  });

  socket.on('disconnecting', (reason) => {
    const query = socket.handshake.query;
    console.warn(
      `[${getNow()}] ${query.room || query.visitor} disconnecting because`,
      reason
    );
    console.warn(`Status of sockets at ${getNow()}`);
    S.rawSockets.forEach((socket) => {
      const { id, visitor, room } = socket[1].handshake.query;
      console.warn(
        '\t',
        id,
        visitor || room,
        socket[1].connected ? 'connected' : 'disconnected'
      );
    });
  });
});
//#endregion

io.on('reconnect', (socket) => {
  // immediately reconnection
  if (socket.handshake.query.id) {
    console.log('...', S.handlePendings(socket.handshake.query));

    console.table(S.sockets);
  }
});

// app.use(express.static(path.join(__dirname, './dist/lct-b')));
app.use('/lct-b', express.static(path.join(__dirname, './dist/lct-b')));

// app.use('/dist', express.static('lct-a-visitor'));
// app.use('/dist', express.static('lct-a-room'));

http.listen(port, hostname, () => {
  console.log(info(`Server.js Build: ${version}`));
  console.log(info(moment().format('llll')));
  console.log(
    `Server running at http://${hostname}:${port}/ (click for web app)`
  );
  console.log(' ');
});
//#endregion
