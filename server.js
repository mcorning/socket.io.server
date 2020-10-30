// jshint esversion: 6

// express code
// require('colors');
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

const express = require('express');
const app = express();

const http = require('http').Server(app);

// setup Socket.io Server and Proxy
const port = process.env.PORT || 3003;
const io = require('socket.io')(http);
io.engine.generateId = (req) => {
  const parsedUrl = new url.parse(req.url);
  const params = new URLSearchParams(parsedUrl.search);
  const prevId = params.get('id');
  // prevId is either a valid id or an empty string
  if (prevId) {
    return prevId;
  }
  return base64id.generateId();
};
const { getNow, logResults, ServerProxy } = require('./radar');
const S = new ServerProxy(io);

const moment = require('moment');
const DEBUG = 0;

const url = require('url');
const base64id = require('base64id');

const { SOURCE, ROOM_TYPE } = require('./types');

// express code
app.use(express.static(__dirname));

app.get('/', function (req, res) {
  res.sendFile(__dirname + '/index.html');
});
process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error', err);
  process.exit(1); //mandatory (as per the Node.js docs)
});
// end express code

// helpers
let logLevel = 0;
function format(text = '', level = logLevel, type = 'output') {
  return { level: level, text: text, type: type };
}

function feedback() {
  function onOpenRoom() {
    logResults.entitle(`Open ${room}`, false);
    // ensure the Room has a room
    logResults.add(format(`${id} joins ${room}`));

    logLevel && S.peek(room);

    logLevel && S.getRooms(ROOM_TYPE.AVAILABLE);
    let msg = `${room} ${
      S.socketIsOnline(id) ? 'is' : 'is not'
    } open for visitors on ${getNow()} using socket ${socket.id}`;

    logResults.add(format(msg));
    logResults.show();
  }

  function onEnterRoom() {
    if (!S.getRooms(ROOM_TYPE.RAW)[data.visitor]) {
      console.log(`${data.visitor.visitor}'s room is empty. Reopening now.`);
      socket.join(data.visitor.visitor);
    }

    console.log('After entering room, all occupied rooms:');
    console.log(
      '-------------------------------------------------------------------'
    );
    S.peek(data.room.room);
    S.peek(data.visitor.visitor);

    const msg = `Using their own socket ${socket.id}, ${data.visitor.visitor} ${
      S.roomIdsIncludeSocket(data.room.room, socket.handshake.query.id)
        ? 'made it into'
        : 'did not make it into'
    } Room [${data.room.room} ${data.room.id}] on ${getNow()}`;
    console.log(warn('Inside enterRoom():', msg));
  }

  function onAlertVisitor() {
    console.log(warn('ALERT!'));
    console.group(`Processing ALERT for ${message.visitor}`);

    console.log(onExposureAlert(message.visitor, 'is online and ALERTED'));

    console.log(onExposureAlert(new Date(), 'pendingVisitors:'));
    console.log([...S.pendingVisitors]);

    console.log(onExposureAlert(msg));
    console.groupEnd();
  }

  function onExposureWarning() {
    if (!message) {
      if (ack) {
        ack('Test passed');
        return;
      }
    }

    console.log(colorExposureWarning(`Socket ${id} WARNED`));

    console.log(colorExposureWarning(`Warning on socket ${id} is PENDING`));
  }
}
// end helpers

// Heavy lifting below
//=============================================================================//

io.on('reconnect', (socket) => {
  // immediately reconnection
  if (socket.handshake.query.id) {
    S.handlePendings(socket.handshake.query);
    console.table(S.sockets);
  }
});

// called when a connection changes
io.on('connection', (socket) => {
  const query = socket.handshake.query;
  // block undefined Rooms
  // if (!query.id || query.room == 'undefined') {
  //   socket.disconnect(true);
  //   console.error('corrupt socket disconnected:', socket.handshake.query);
  // }
  // immediately upon connection: check for pending warnings and alerts
  if (query.id) {
    let result = S.handlePendings(query);
    query.result = result;
    console.group(`[${getNow()}] All Sockets`);
    console.log(S.sockets);
    console.groupEnd();
  }
  //...........................................................................//
  //listeners

  // called by State Machine to bring a Room online
  // so that Visitors can enter
  // this can change the state of io..rooms
  // next step in the pipeline is to access pending Visitor exposure warnings
  const onOpenRoom = (data, ack) => {
    try {
      const { room, id, nsp } = data;

      socket.join(room);
      const assertion = S.roomIdsIncludeSocket(room, id);

      console.assert(assertion, `${id} unable to join ${room}`);

      if (ack) {
        ack({ event: 'onOpenRoom', room: room, result: assertion });
      }
    } catch (error) {
      console.error('Oops, onOpenRoom() hit this:', error.message);
    }
  };
  // Room sends this event
  // Server forwards content to Visitor(s) with exposureAlert event
  function onAlertVisitor(data, ack) {
    // Visitor message includes the Room names to alert
    try {
      const { message, visitor, id } = data;

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

      let result = S.alertVisitor(data);
      if (ack) {
        ack(result);
      }
    } catch (error) {
      console.error('onAlertVisitor sees:', error);
    }
  }
  // Visitor sends this event
  const onEnterRoom = (data, ack) => {
    try {
      const { room, id, nsp, sentTime, visitor } = data;

      // Enter the Room. As others enter, you will see a notification they, too, joined.
      socket.join(room.room);

      const assertion = S.roomIdsIncludeSocket(
        room.room,
        socket.handshake.query.id
      );
      console.assert(assertion, 'Could not enter Room');

      // handled by Room.checkIn()
      // sending to individual socketid (private message)
      io.to(room.room).emit('checkIn', {
        visitor: visitor,
        sentTime: sentTime,
        room: room,
        message: 'Entered',
        socketId: socket.id,
      });

      const o = S.getOccupancy(room.room);
      console.log(warn(`${room.room} has ${o} occupants now.`));

      if (ack) {
        ack({
          event: 'onEnterRoom',
          room: room,
          result: assertion,
          emits: 'checkIn',
        });
      }
    } catch (error) {
      console.error('Oops, onEnterRoom() hit this:', error);
    }
  };

  // Visitor sends this event containing all warnings for all exposed Rooms
  const onExposureWarning = (data, ack) => {
    try {
      const { visitor, warnings } = data;
      console.table(data);
      let results = [];
      // iterate collection notifying each Room separately
      Object.entries(warnings).forEach((warning) => {
        results.push(S.notifyRoom({ warning: warning, visitor: visitor }));
      });

      if (ack) {
        ack({
          event: 'onExposureWarning',
          result: results,
          emit: 'notifyRoom',
        });
      }
    } catch (error) {
      console.error('onExposureWarning sees:', error);
    }
  };

  const onLeaveRoom = (data, ack) => {
    socket.leave(data.room.room);

    // handled by Room.checkOut()
    // sending to individual socketid (private message)
    io.to(data.room.room).emit('checkOut', {
      visitor: data.visitor,
      sentTime: data.sentTime,
      room: data.room,
      message: data.message,
    });

    updateOccupancy(data.room.room);

    const msg = `Using their own socket ${socket.id}, ${data.visitor.visitor} ${
      roomIdsIncludeSocket(data.room.room, socket.handshake.query.id)
        ? 'did not make it out of'
        : 'made it out of'
    } Room [${data.room.room} ${data.room.id}] on ${getNow()}`;

    console.log(warn('leaveRoom():', msg));
    if (ack) {
      ack(msg);
    }
  };

  const onCloseRoom = function (data, ack) {
    try {
      const { room, message, nsp } = data;

      console.log(`${socket.id} is leaving Room ${socket.room} (${room})`);
      // leaveRoom(socket, socket.room);
      socket.leave(socket.room);
      io.in(room).send(
        `${room} is closed, so you should not see this message. Notify developers of error, please.`
      );
      ack({
        message:
          message == 'Closed'
            ? `Well done, ${socket.room}. See you tomorrow?`
            : `Closed room ${socket.room}. You can add it back later.`,
        error: '',
      });

      getRooms(ROOM_TYPE.AVAILABLE);
    } catch (error) {
      console.error('Oops, closeRoom() hit this:', error.message);
    }
  };

  // end listeners
  //...........................................................................//

  //+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++//
  // Socket Events
  // Rooms send these events
  socket.on('openRoom', onOpenRoom); // sent from Room for each visitor
  socket.on('closeRoom', onCloseRoom);
  // (each Visitor warned each Room the date(s) Visitor occupied the Room)
  socket.on('alertVisitor', onAlertVisitor);

  // sent from Visitor
  // Visitor sends this message:
  // {visitor:{name, id, nsp}, room:{room, id, nsp}, message:{}, sentTime: dateTime}
  // disambiguate enterRoom event from the event handler in the Room, checkIn
  socket.on('enterRoom', onEnterRoom);
  socket.on('leaveRoom', onLeaveRoom);
  socket.on('exposureWarning', onExposureWarning);
  // disambiguate leaveRoom event from the event handler in the Room, checkOut

  // end Socket Events
  //+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++//

  // Admin events (for Room managers use)
  socket.on('exposeAllRooms', (data, ack) => {
    if (ack) {
      ack(S.rooms);
    }
  });
  socket.on('exposeAllSockets', (data, ack) => {
    if (ack) {
      ack(S.sockets);
    }
  });
  socket.on('exposeOccupiedRooms', (data, ack) => {
    if (ack) {
      ack(S.occupied);
    }
  });
  socket.on('exposePendingWarnings', (data, ack) => {
    if (ack) {
      ack(S.pendingWarnings);
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
    ack(`Server is at your disposal, ${data}`);
  });

  socket.on('disconnected', () => {
    console.log('Remaining Sockets:');
    console.table(S.sockets);
  });

  socket.on('disconnecting', (reason) => {
    console.warn('!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.warn(
      getNow(),
      `Disconnecting Socket ${
        socket.handshake.query.visitor ||
        socket.handshake.query.room ||
        socket.handshake.query.admin
      } (${socket.id}) `
    );
    console.warn('Reason:', reason);
    console.warn('!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  });

  socket.on('disconnectAll', () => {
    Object.values(io.sockets.clients().connected).map((v) => v.disconnect());
    console.log('Remaining connections :>> ', io.sockets.connected);
  });
});

http.listen(port, function () {
  console.log(notice('Build: 10.06.16.27'));
  console.log(notice(moment().format('llll')));
  console.log(
    notice(`socket.io server listening on http://localhost: ${port}`)
  );
  console.log();
});
