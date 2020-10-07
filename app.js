// jshint esversion: 6

// express code
// require('colors');
const clc = require('cli-color');
const success = clc.red.green;
const error = clc.red.bold;
const warn = clc.yellow;
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
let pendingRoomWarnings = new Map();
let pendingVisitors = new Map();
let pendingRooms = new Set();
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
function openMyRoom(socket) {
  const name = socket.handshake.query.token;
  console.groupCollapsed();

  socket.join(name);
  let x = new Map(Object.entries(getRooms(ROOM_TYPE.RAW)));
  if (x.has(name)) {
    console.log(success(`${name}'s socket ${socket.id} added to Room`));
  } else {
    console.log(error(`Could not find ${name}'s Room`));
  }

  // Check for pending warnings for this Visitor
  if (pendingVisitors.has(name)) {
    // sending to all clients in 'game' room except sender
    console.log(warn('Emitting exposureAlert'));
    socket.emit('exposureAlert', pendingVisitors.get(name));
  } else {
    console.log('No pending warnings for', name);
  }

  if (name.includes('.')) {
    updateOccupancy();

    // manual test of testing model
    if (DEBUG) {
      console.warn('TESTING ALERT. THIS IS ONLY A DRILL.');
      socket.emit('exposureAlert', 'You may have been exposed to COVID-19');
    }
  }
  console.groupEnd();
}

const getNow = () => {
  return moment().format('lll');
};

const checkPendingRoomWarnings = (room) => {
  console.log('In checkPendingRoomWarnings for', room);
  if (!pendingRoomWarnings.size) {
    return;
  }
  // key is the message sent from the Visitor (stored as value)
  pendingRoomWarnings.forEach((value, key) => {
    console.log('Checking for pending warnings for Room', room);
    if (Object.keys(key.warnings).includes(room)) {
      const message = {
        visitor: key.visitor,
        exposureDates: key.warnings[room],
        room: room,
      };
      DEBUG && console.log('message in notifyRoom');
      DEBUG && console.table(message);
      // sending to individual socketid (private message)
      io.to(room).emit('notifyRoom', message);
      pendingRoomWarnings.delete(key);
    }
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

const getRooms = (roomType) => {
  if (!io.nsps[namespace]) {
    console.error(`${namespace} is invalid. Reset to default "/" value.`);
    namespace = '/';
  }
  const allRooms = io.nsps[namespace].adapter.rooms;

  let rooms;

  if (roomType == ROOM_TYPE.RAW) {
    //make rooms look like this: '[{"name":"Heathlands.Medical","id":"P9AdUxzLaJqE3i1PAAAA"}]'

    rooms = Object.keys(allRooms).map((v) => {
      return { name: v, id: Object.keys(allRooms[v].sockets)[0] };
    });
    io.of(namespace).emit('allRoomsExposed', rooms);
    return allRooms;
  }

  switch (roomType) {
    case ROOM_TYPE.PENDING:
      if (!pendingRooms.size) {
        return [];
      }

      console.log('pendingRooms:', [...pendingRooms.values()]);
      // sending to all clients in namespace 'myNamespace', including sender
      io.of(namespace).emit('pendingRoomsExposed', [...pendingRooms.values()]);

      break;

    case ROOM_TYPE.AVAILABLE:
      rooms = Object.keys(allRooms)
        .filter((v) => v.includes('.'))
        .map((v) => {
          checkPendingRoomWarnings(v);
          if (allRooms[v]) {
            return { name: v, id: Object.keys(allRooms[v].sockets)[0] };
          }
        });
      console.log('Available Rooms:');
      console.table(rooms);
      // sending to all clients in namespace 'myNamespace', including sender
      io.of(namespace).emit('availableRoomsExposed', rooms);
      return rooms;

    case ROOM_TYPE.OCCUPIED:
      rooms = Object.entries(allRooms).filter(
        (v) => v[0].includes('.') && v[1].length > 1
      );
      console.log('Occupied Rooms:');
      console.table(rooms);
      // sending to all clients in namespace 'myNamespace', including sender
      io.of(namespace).emit('occupiedRoomsExposed', rooms);
      return rooms;

    case ROOM_TYPE.VISITOR:
      rooms = Object.keys(allRooms)
        .filter((v) => !v.includes('.') && v.length < 20)
        .map((v) => {
          return { name: v, id: Object.keys(allRooms[v].sockets)[0] };
        });
      console.log('Visitors Rooms:');
      console.table(rooms);
      // sending to all clients in namespace 'myNamespace', including sender
      io.of(namespace).emit('visitorsRoomsExposed', rooms);
      return rooms;
  }
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

  console.log();
};

// Heavy lifting below
//=============================================================================//
// called when a connection changes
io.on('connection', (socket) => {
  if (socket.handshake.query.token) {
    console.log(' ');
    console.log(
      highlight(
        moment().format('HH:mm:ss'),
        'Opening connection to a',
        socket.handshake.query.token
      )
    );
    openMyRoom(socket);
  }

  //Alerts
  // sent from Room for each visitor (who warned each Room Visitor occupied)
  socket.on('alertVisitor', function (message, ack) {
    // Visitor message includes the Room names to alert
    try {
      // Ensure Visitor is online to see alert, otherwise cache and send when they login again
      let online = Object.keys(getRooms(ROOM_TYPE.RAW)).filter(
        (v) => v === message.visitor
      );
      if (online.length == 0) {
        pendingVisitors.set(message.visitor, message.message);
        console.log(new Date(), 'pendingVisitors:');
        console.log([...pendingVisitors]);
        io.of(namespace).emit('pendingVisitorsExposed', [...pendingVisitors]);
        ack(`Server: ${message.visitor} unavailable. Deferred alert.`);
      } else {
        console.info(message.visitor, 'alerted');
        // sending to visitor socket in visitor's room (except sender)
        socket.to(message.visitor).emit('exposureAlert', message.message);
        ack(`Server: Alerted ${message.visitor}`);
      }
    } catch (error) {
      console.error(error);
    }
  });

  // A Visitor has collected all the rooms and dates visited
  // Visitor sends each Room with visited dates in an object
  // If a Room is unavailable, we cache the warning and
  // derefernce the Room name in checkPendingRoomWarnings().
  socket.on('exposureWarning', function (message, ack) {
    // Example message:
    // {
    //    sentTime:'2020-09-19T00:56:54.570Z',
    //    visitor:'Nurse Jackie',
    //    warnings:{
    //      Heathlands.Medical:[
    //        '2020-09-19T00:33:04.248Z', '2020-09-19T00:35:38.078Z', '2020-09-14T02:53:33.738Z', '2020-09-18T02:53:35.050Z'
    //      ]
    //    }
    // };

    const { sentTime, visitor, warnings } = message;
    console.log('exposureWarnings', JSON.stringify(message));
    console.table(message);

    let availableRooms = getRooms(ROOM_TYPE.AVAILABLE);
    if (!availableRooms.length) {
      // add all Rooms in message to the cache.
      pendingRoomWarnings.set(message);

      console.table('Entire message contains pendingRoomWarnings', [
        ...pendingRoomWarnings,
      ]);

      ack(
        `WARNING: No rooms online. Will warn ${Object.keys(
          message
        )} when they connect.`
      );
      return;
    }

    // we use set operations to identify unavailable Rooms
    // the first set contains available Rooms
    let available = new Set(availableRooms.map((v) => v.name));
    console.log('available', [...available]);

    // start with the full list in the message from the Visitor
    if (!warnings) {
      let msg =
        'WARNING: No warnings exposed. This is probably a contract violation. Check client code for proper message format.';
      ack ? ack(msg) : console.log(msg);

      return;
    }
    let exposed = new Set(Object.keys(warnings));
    console.log('exposed', [...exposed]);

    // now we separate the wheat from the chaff
    pendingRooms = difference(exposed, available);
    console.log('pendingRooms:', pendingRooms);
    // cache pending warnings
    // {
    //    sentTime:'2020-09-19T00:56:54.570Z'
    //    visitor:'Nurse Jackie'
    //    warnings:{
    //      Heathlands.Medical:[
    //        '2020-09-19T00:33:04.248Z', '2020-09-19T00:35:38.078Z', '2020-09-14T02:53:33.738Z', '2020-09-18T02:53:35.050Z'
    //      ]
    //    }
    // };
    pendingRooms.forEach((room) => {
      let x = {};
      x[room] = warnings[room];
      pendingRoomWarnings.set({
        visitor: visitor,
        warnings: x,
        sentTime: sentTime,
      });
    });
    console.log('pendingRoomWarnings', [...pendingRoomWarnings]);

    let alerted = intersection(exposed, available);
    // notify online Rooms
    alerted.forEach((room) => {
      let warning = warnings[room];
      exposureDates = warning;
      console.log(room);
      console.log('Warning Room:', room, 'with', exposureDates);

      // sending to individual socketid (private message)
      io.to(room).emit(
        'notifyRoom',
        {
          visitor: visitor,
          exposureDates: exposureDates, // exposure dates array
          room: room,
        },
        ack(`Server: ${room} notified`)
      );
    });
  });

  // Admin events (for Room managers use)
  socket.on('exposeAllRooms', () => {
    getRooms(ROOM_TYPE.RAW);
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

  // Visitor sends this message
  // disambiguate enterRoom event from the event handler in the Room, checkIn
  socket.on('enterRoom', function (data) {
    if (!getRooms(ROOM_TYPE.RAW)[data.visitor]) {
      console.log(`${data.visitor}'s room is empty. Reopening now.`);
      socket.join(data.visitor);
    }

    socket.visitor = data.visitor;
    socket.payload = data;

    // Enter the Room. As others enter, you will see a notification they, too, joined.
    socket.join(data.room);
    console.log('After entering room, all occupied rooms:');
    console.log(
      '-------------------------------------------------------------------'
    );
    // handled by Room.checkIn()
    // sending to individual socketid (private message)
    io.to(data.room).emit('checkIn', {
      visitor: data.visitor,
      sentTime: data.sentTime,
      room: data.room,
      message: data.message,
      socketId: socket.id,
    });

    updateOccupancy(data.room);
  });

  // disambiguate leaveRoom event from the event handler in the Room, checkOut
  socket.on('leaveRoom', function (data) {
    socket.leave(data.room);

    // handled by Room.checkOut()
    // sending to individual socketid (private message)
    io.to(data.room).emit('checkOut', {
      visitor: data.visitor,
      sentTime: data.sentTime,
      room: data.room,
      message: data.message,
    });

    updateOccupancy(data.room);

    console.log(
      `Sockets in ${data.visitor}'s Room: `,
      getRooms(ROOM_TYPE.RAW)[data.visitor]
    );
  });

  // Rooms
  socket.on('openRoom', function (data, ack) {
    try {
      // ensure the Room has a room

      socket.room = data;
      console.log('\n', getNow(), 'socket.id opening:>> ', data, socket.id);
      socket.join(data);
      if (ack) {
        ack({
          message: `${socket.room}, you are open for business. Keep your people safe today.`,
          error: '',
        });
      }
      getRooms(ROOM_TYPE.AVAILABLE);
    } catch (error) {
      console.error('Oops, openRoom() hit this:', error.message);
    }
  });

  socket.on('closeRoom', function (data, ack) {
    try {
      console.log(`${socket.id} is leaving Room ${socket.room}`);
      // leaveRoom(socket, socket.room);
      socket.leave(socket.room);
      io.in(data.room).send(
        `${data.room} is closed, so you should not see this message. Notify developers of error, please.`
      );
      ack({
        message:
          data.message == 'Closed'
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

  socket.on('disconnect', (reason) => {
    console.warn('!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.warn(
      getNow(),
      `Disconnecting Socket ${socket.name} (${socket.id}) `
    );
    console.warn('Reason:', reason);
    console.warn('!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    getRooms(ROOM_TYPE.AVAILABLE);
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
