// jshint esversion: 6

// express code
// require('colors');
const clc = require('cli-color');
const success = clc.red.green;
const onExposureAlert = clc.green;
const onExposureWarning = clc.yellow.red;
// const onNotifyRoom = clc.green;
// const onAlertVisitor = clc.yellow.red;
const error = clc.red.bold;
const warn = clc.yellow;
const info = clc.cyan;
const notice = clc.blue;
const highlight = clc.magenta;
const bold = clc.bold;
const express = require('express');
const app = express();

const http = require('http').Server(app);
const io = require('socket.io')(http);
const port = process.env.PORT || 3003;

const moment = require('moment');
const DEBUG = 0;

const url = require('url');
const base64id = require('base64id');

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

app.use(express.static(__dirname));

app.get('/', function (req, res) {
  res.sendFile(__dirname + '/index.html');
});
process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error', err);
  process.exit(1); //mandatory (as per the Node.js docs)
});
// end express code

// globals
let namespace = '/';
let pendingWarnings = new Map();
let pendingVisitors = new Map();
const SOURCE = {
  SERVER: 'server',
  VISITOR: 'visitor',
  ROOM: 'room',
  ADMIN: 'admin',
};

// Event Heloers
const privateMessage = (room, event, message) => {
  // sending to individual socketid (private message)
  // e.g.,
  // io.to(room).emit(
  //   'notifyRoom',
  //   {
  //     visitor: visitor,
  //     exposureDates: exposureDates, // exposure dates array
  //   }
  // );
  // note: cannot attach callback to namespace broadcast event
  io.to(room).emit(event, message);
};

// end Event helpers
// Main functions

/* warning example:
{
  room:'Heathlands.Medical',
  id:'',
  dates:[
    '2020-09-19T00:33:04.248Z', '2020-09-14T02:53:33.738Z', '2020-09-18T07:15:00.00Z'
  ]
}
  */
const warnRoom = (visitor, warning) => {
  message = {
    exposureDates: warning.dates,
    room: warning.room,
    visitor: visitor,
  };
  privateMessage(warning.room, 'notifyRoom', message);
};

/* warning example:
{
  room:'Heathlands.Medical',
  id:'',
  dates:[
    '2020-09-19T00:33:04.248Z', '2020-09-14T02:53:33.738Z', '2020-09-18T07:15:00.00Z'
  ]
}
  */
const cacheWarning = (warning) => {
  pendingWarnings.set(warning.id, warning);
};

// end Main Functions

const ROOM_TYPE = {
  RAW: 0,
  AVAILABLE: 1,
  OCCUPIED: 2,
  VISITOR: 4,
  PENDING: 8,
};

// Server helper methods
// multiplexing method can be called by Visitor or Room
// uses the same socket to carry any Room or Visitor
function peek(name) {
  const json = io.nsps[namespace].adapter.rooms[name].sockets;

  let str = warn('sockets:', JSON.stringify(json, null, '\t'));
  console.log(name, str);
}
function openMyRoom(socket) {
  const query = socket.handshake.query;
  const name = query.visitor || query.room || query.admin;
  console.groupCollapsed('openMyRoom: ');
  // it may be possible that a Visitor Room houses two different sockets with the same name (but different query.ids)
  // so always check for the correct id given the subject socket
  socket.join(name);
  if (roomIdsIncludeSocket(name, socket.id)) {
    console.log(
      success(`${name}'s socket ${socket.id} added to their own named Room`)
    );
  } else {
    console.log(error(`Could not find ${name}'s Room`));
  }

  // Check for pending warning for this Visitor
  if (pendingVisitors.has(name)) {
    // sending to all clients in 'game' room except sender
    console.log(
      onExposureAlert(`${name.toUpperCase()} was PENDING. Now ALERTED.`)
    );
    socket.emit('exposureAlert', pendingVisitors.get(name));
  } else {
    console.log('No pending warning for', name);
  }
  // using name means either a Room or a Visitor room will update its occupancy.
  // where one name has more than one id, occupancy will update accordingly
  updateOccupancy(name);

  console.groupEnd();
}

const getNow = () => {
  return moment().format('lll');
};

// look for pending warnings for specified Room
const checkPendingRoomWarnings = (room) => {
  console.log('In checkPendingRoomWarnings for', room.room);
  if (!pendingWarnings.size || !pendingWarnings.has(room.id)) {
    return;
  }
  pendingWarnings.forEach((value, key) => {
    const message = {
      visitor: '',
      exposureDates: value,
      room: key,
    };
    privateMessage(room.room, 'notifyRoom', message);
    pendingWarnings.delete(key);
    console.group('Pending Warnings:');

    console.log(warn(JSON.stringify(message, null, 3)));
    console.groupEnd();
  });
};

function intersection(setA, setB) {
  let _intersection = new Set();
  for (let elem of setB) {
    if (setA.has(elem)) {
      _intersection.add(elem);
    }
  }
  return _intersection;
}

function difference(setA, setB) {
  let _difference = new Set(setA);
  for (let elem of setB) {
    _difference.delete(elem);
  }
  return _difference;
}

const getAllRoomIds = () => {
  return io.nsps[namespace].adapter.rooms;
};
const roomIdsIncludeSocket = (roomName, id) => {
  try {
    return io.nsps[namespace].adapter.rooms[roomName].sockets[id];
  } catch (error) {
    console.error(error);
    console.log('Returning false');
    return false;
  }
};

const roomIsOnline = (roomName) => {
  return io.nsps[namespace].adapter.rooms[roomName];
};

const getAllSocketQueries = () => {
  let allSockets = Object.entries(io.nsps[namespace].adapter.nsp.sockets).map(
    (v) => {
      let q = v[1].handshake.query;
      if (q.admin) {
        return { admin: q.admin, id: q.id, nsp: q.nsp };
      } else if (q.visitor) {
        return { visitor: q.visitor, id: q.id, nsp: q.nsp };
      }
      return { room: q.room, id: q.id, nsp: q.nsp };
    }
  );
  return allSockets;
};

const getAvailableRooms = () => {
  return Object.entries(io.nsps[namespace].adapter.nsp.sockets)
    .map((v) => v[1].handshake.query)
    .filter((v) => v.room && v.room != 'undefined');
};

const getOccupiedRooms = () => {
  rooms = Object.entries(getAllRoomIds).filter((v) => v[1].length > 1);
};

const getRooms = (roomType) => {
  if (!io.nsps[namespace]) {
    console.error(`${namespace} is invalid. Reset to default "/" value.`);
    namespace = '/';
  }
  let rooms;

  if (roomType == ROOM_TYPE.RAW) {
    let roomIds = getAllRoomIds();
    io.of(namespace).emit('allRoomsExposed', roomIds);
    return roomIds;
  }

  switch (roomType) {
    case ROOM_TYPE.PENDING:
      // if (!pendingRooms.size) {
      //   return [];
      // }
      if (pendingWarnings.size) {
        console.log('Pending Rooms:');
        console.table([...pendingWarnings]);
      } else {
        console.log('No Rooms pending');
      }
      io.of(namespace).emit('pendingRoomsExposed', [...pendingWarnings]);

      break;

    case ROOM_TYPE.AVAILABLE:
      // rooms = getAvailableRooms().map((v) => {
      //   checkPendingRoomWarnings(v);
      //   return { name: v.room, id: v.id, nsp: v.nsp };
      // });
      rooms = getAllSocketQueries().filter((v) => v.room);
      rooms.forEach((room) => checkPendingRoomWarnings(room));
      if (rooms) {
        console.log('Available Rooms:');
        console.table(rooms);
      } else {
        console.log('No Rooms available');
      }
      // sending to all clients in namespace, including sender
      io.of(namespace).emit('availableRoomsExposed', rooms);
      return rooms;

    case ROOM_TYPE.OCCUPIED:
      // do we see length in keys?
      rooms = Object.keys(getAllRoomIds).filter((v) => v[1].length > 1);
      if (rooms) {
        console.log('Occupied Rooms:');
        console.table(rooms);
      } else {
        console.log('No Rooms are occupied');
      } // sending to all clients in namespace 'myNamespace', including sender
      io.of(namespace).emit('occupiedRoomsExposed', rooms);
      return rooms;

    case ROOM_TYPE.VISITOR:
      rooms = getAllSocketQueries().filter((v) => v.visitor);
      if (rooms) {
        console.log('Visitor Rooms:');
        console.table(rooms);
      } else {
        console.log('No Visitor Rooms online');
      }
      // sending to all clients in namespace 'myNamespace', including sender
      console.log(
        info(
          `Emitting visitorsRoomsExposed to all sockets in namespace ${namespace}`
        )
      );
      io.of(namespace).emit('visitorsRoomsExposed', rooms);
      return rooms;
  }
};

const getSockets = () => {
  let allSockets = Object.entries(
    io.nsps[namespace].adapter.nsp.sockets
  ).reduce((a, c) => {
    let query = c[1].handshake.query;
    let b = {
      id: c[0],
      room: query.room,
      visitor: query.visitor,
      uniqueName: query.id,
      namespace: query.nsp,
      connected: c[1].connected,
    };
    a.push(b);
    return a;
  }, []);
  console.log('All Sockets:');
  console.table(allSockets);

  io.of(namespace).emit('allSocketsExposed', allSockets);
  return allSockets;
};

// room is undefined when all we need to do is update visitors rooms
const updateOccupancy = (room) => {
  let allRooms = getRooms(ROOM_TYPE.RAW);

  if (room && allRooms[room]) {
    let occupancy = allRooms[room].length || 0;
    // getRooms() will fire occupiedRoomsExposed event
    getRooms(ROOM_TYPE.OCCUPIED);
    // sending to all clients in namespace 'myNamespace', including sender
    io.of(namespace).emit('updatedOccupancy', {
      room: room,
      occupancy: occupancy,
    });
  }
  // here getRooms() will fire visitorsRoomsExposed event so Admin sees updated list of Visitors
  getRooms(ROOM_TYPE.VISITOR);

  console.log(' ');
};

// Heavy lifting below
//=============================================================================//
// called when a connection changes
io.on('connection', (socket) => {
  // feedback
  let query = socket.handshake.query;
  if (query.room) {
    checkPendingRoomWarnings(query);
  }

  if (query.admin || query.visitor || query.room) {
    console.log(' ');
    console.log(
      highlight(
        moment().format('HH:mm:ss'),
        'In connection handler: Opening connection to a Room for:',
        query.admin || query.visitor || query.room,
        'using socketId:',
        query.id
      )
    );
    // end feedback

    openMyRoom(socket);
  }

  //Alerts
  // sent from Room for each visitor
  // (each Visitor warned each Room the date(s) Visitor occupied the Room)
  socket.on('alertVisitor', function (message, ack) {
    // Visitor message includes the Room names to alert
    try {
      // Ensure Visitor is online to see alert, otherwise cache and send when they login again
      let online = Object.keys(getRooms(ROOM_TYPE.RAW)).filter(
        (v) => v === message.visitor
      );
      getRooms(ROOM_TYPE.AVAILABLE);
      console.log(onExposureAlert(`Is ${message.visitor} in that list?`));
      if (roomIsOnline(message.visitor)) {
        console.log(onExposureAlert(message.visitor, 'is online and ALERTED'));
        // sending to visitor socket in visitor's room (except sender)
        socket.to(message.visitor).emit('exposureAlert', message.message);
        ack(`Server: Alerted ${message.visitor}`);
      } else {
        pendingVisitors.set(message.visitor, message.message);
        console.log(onExposureAlert(new Date(), 'pendingVisitors:'));
        console.log([...pendingVisitors]);
        io.of(namespace).emit('pendingVisitorsExposed', [...pendingVisitors]);
        const msg = `Server: ${message.visitor} unavailable. DEFERRED ALERT.`;
        console.log(onExposureAlert(msg));
        ack(msg);
      }
    } catch (error) {
      console.error(error);
    }
  });

  // A Visitor has collected all the rooms and dates visited in the last 14 days.
  // Visitor sends an exposure warning to each Room (with visited dates in an object parameter).
  // Example message:
  // {
  //    sentTime:'2020-09-22T07:56:54.570Z',
  //    visitor:{visior:'AirGas Inc', id:'JgvrILSxDwXRWJUpAAAC', nsp:'enduringNet'}
  //    warnings:[
  //      {
  //         room:'Heathlands.Medical',
  //          id:'d6QoVa_JZxnM_0BoAAAA',
  //          dates:[
  //           '2020-09-19T00:33:04.248Z'
  //          ]
  //      },
  //      {
  //         room:'Heathlands Cafe',
  //          id:'e1suC3Rdpj_1PuR3AAAB',
  //          dates:[
  //           '2020-09-19T01:00:04.248Z',
  //           '2020-09-20T01:09:00.000Z'
  //          ]
  //      },
  //    ]
  // };
  // If a Room is not available (not online), we cache the warning.
  // When a Room comes online, we derefernce the Room name in checkPendingRoomWarnings() and send any waiting warning.
  socket.on('exposureWarning', function (message, ack) {
    // server accepts all Room warnings from Visitor
    // then sends each Room its set of warning dates using notifyRoom
    message.warnings.forEach((warning) => {
      const room = warning.room;
      if (roomIsOnline(room)) {
        warnRoom(message.visitor.visitor, warning);
        console.log(onExposureWarning(`${room} WARNED`));
        if (ack) {
          ack(`exposureWarning WARNED ${room}`);
        }
      } else {
        cacheWarning(warning);
        console.log(onExposureWarning(`${room} warning is PENDING`));
        if (ack) {
          ack(`exposureWarning warning is PENDING for ${room}`);
        }
      }
    });
  });

  socket.on('exposureWarningX', function (message, ack) {
    const { sentTime, visitor, warning } = message;
    console.log('exposureWarning', JSON.stringify(message, null, '\t'));
    console.table(message);

    let availableRooms = getRooms(ROOM_TYPE.AVAILABLE);
    if (!availableRooms.length) {
      pendingWarnings.set(message);

      console.table('Entire message contains pendingWarnings', [
        ...pendingWarnings,
      ]);
      let msg = `WARNING: No rooms online. Will warn ${message.warning.room.room} when they connect.`;
      ack(msg);
      return;
    }

    // we use set operations to identify unavailable Rooms
    // the first set contains available Rooms
    let available = new Set(availableRooms.map((v) => v.name));
    console.log('available', [...available]);

    // start with the full list in the message from the Visitor
    if (!warning) {
      let msg =
        'WARNING: No warning exposed. This is probably a contract violation. Check client code for proper message format.';
      ack ? ack(msg) : console.log(msg);

      return;
    }
    // warning is an object, one for each Room
    let exposed = new Set(Object.keys(warning));
    console.log('exposed', [...exposed]);

    // now we separate the wheat from the chaff
    // available-exposed=pending
    pendingRooms = difference(exposed, available);
    console.log('pendingRooms:', pendingRooms);
    // WARNING MESSAGE STRUCT:
    //{
    //   sentTime: '2020-09-19T00:56:54.570Z',
    //   visitor: {
    //     visior: 'Nurse Jackie',
    //     id: 'FWzLl5dS9sr9FxDsAAAB',
    //     nsp: 'enduringNet',
    //   },
    //   warning: {              // ONE ROOM PER WARNING
    //     room: {
    //       room: 'Heathlands Medical',
    //       id: 'd6QoVa_JZxnM_0BoAAAA',
    //       nsp: 'enduringNet',
    //     },
    //     dates: [
    //       '2020-09-19T00:33:04.248Z',  // WARNING CAN
    //       '2020-09-14T02:53:33.738Z',  // HAVE MULTIPLE
    //       '2020-09-18T07:15:00.00Z',   // VISIT DATES
    //     ],
    //   },
    // };
    pendingRooms.forEach((room) => {
      pendingWarnings.set(room, [
        ...(pendingWarnings.get(room) || []),
        ...message.warning[room],
      ]);
    });
    console.log('pendingWarnings:');
    console.table(pendingWarnings);

    let alerted = intersection(exposed, available);
    // notify online Rooms
    alerted.forEach((room) => {
      let warning = warning[room];
      exposureDates = warning.dates;
      console.log(room);
      console.log('Warning Room:', room, 'with', exposureDates);

      // sending to individual socketid (private message)
      // io.to(room).emit(
      //   'notifyRoom',
      const message = {
        visitor: visitor,
        exposureDates: exposureDates, // exposure dates array
        room: room,
      };
      //   ack(`Server: ${room} notified`)
      // );
      privateMessage(room, 'notifyRoom', message, {
        source: SOURCE.Server,
        message: `Notified ${room}`,
      });
    });
  });

  // Admin events (for Room managers use)
  socket.on('exposeAllRooms', () => {
    getRooms(ROOM_TYPE.RAW);
  });
  socket.on('exposeAllSockets', () => {
    getSockets();
  });
  socket.on('exposeOccupiedRooms', () => {
    getRooms(ROOM_TYPE.OCCUPIED);
  });
  socket.on('exposePendingRooms', () => {
    getRooms(ROOM_TYPE.PENDING);
  });
  socket.on('exposeAvailableRooms', () => {
    getRooms(ROOM_TYPE.AVAILABLE);
  });
  socket.on('exposeVisitorsRooms', () => {
    getRooms(ROOM_TYPE.VISITOR);
  });

  // Visitor sends this message:
  // {visitor:{name, id, nsp}, room:{room, id, nsp}, message:{}, sentTime: dateTime}
  // disambiguate enterRoom event from the event handler in the Room, checkIn
  socket.on('enterRoom', function (data, ack) {
    if (!getRooms(ROOM_TYPE.RAW)[data.visitor]) {
      console.log(`${data.visitor.visitor}'s room is empty. Reopening now.`);
      socket.join(data.visitor.visitor);
    }

    // socket.visitor = data.visitor;
    // socket.payload = data;

    // Enter the Room. As others enter, you will see a notification they, too, joined.
    socket.join(data.room.room);

    console.log('After entering room, all occupied rooms:');
    console.log(
      '-------------------------------------------------------------------'
    );
    peek(data.room.room);
    peek(data.visitor.visitor);
    // handled by Room.checkIn()
    // sending to individual socketid (private message)
    io.to(data.room.room).emit('checkIn', {
      visitor: data.visitor.visitor,
      sentTime: data.sentTime,
      room: data.room.room,
      message: 'Entered',
      socketId: socket.id,
    });

    updateOccupancy(data.room.room);

    const msg = `Using their own socket ${socket.id}, ${data.visitor.visitor} ${
      roomIdsIncludeSocket(data.room.room, socket.handshake.query.id)
        ? 'made it into'
        : 'did not make it into'
    } Room [${data.room.room} ${data.room.id}] on ${getNow()}`;
    console.log(warn('Inside enterRoom():', msg));
    if (ack) {
      ack(msg);
    }
  });

  // disambiguate leaveRoom event from the event handler in the Room, checkOut
  socket.on('leaveRoom', function (data, ack) {
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
  });

  // Rooms send these events
  socket.on('openRoom', function (data, ack) {
    try {
      const { room, id, nsp } = data;
      // ensure the Room has a room
      console.log('\n', getNow(), 'socket.id opening:>> ', id, 'for', room);
      socket.join(room);
      peek(room);
      let x =
        io.nsps[namespace].adapter.rooms[room].sockets[
          Object.keys(io.nsps[namespace].adapter.rooms[room].sockets)[0]
        ];
      let msg = `${room} ${
        x ? 'is' : 'is not'
      } open for visitors on ${getNow()} using socket ${socket.id}`;
      if (ack) {
        ack({ name: room, msg: msg, id: socket.id });
      }
      getRooms(ROOM_TYPE.AVAILABLE);
    } catch (error) {
      console.error('Oops, openRoom() hit this:', error.message);
    }
  });

  socket.on('closeRoom', function (data, ack) {
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
  });

  socket.on('pingServer', function (data, ack) {
    ack(`Server is at your disposal, ${data}`);
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
    getRooms(ROOM_TYPE.AVAILABLE);
    getRooms(ROOM_TYPE.VISITOR);
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
