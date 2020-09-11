// express code
require('colors');
const express = require('express');
const app = express();

const http = require('http').Server(app);
const io = require('socket.io')(http);
const port = process.env.PORT || 3003;

const M = require('moment');

app.use(express.static(__dirname));

app.get('/', function (req, res) {
  res.sendFile(__dirname + '/index.html');
});
// end express code

// globals
let namespace = '/';
const unavailableRooms = new Map();
const ROOM_TYPE = {
  AVAILABLE: 1,
  OCCUPIED: 2,
  VISITOR: 4,
};
// Server helper methods
const getNow = () => {
  return M().format('lll');
};

const getRooms = (roomType) => {
  const allRooms = io.nsps[namespace].adapter.rooms;
  let rooms = Object.keys(allRooms);
  switch (roomType) {
    case ROOM_TYPE.AVAILABLE:
      let x = rooms.filter((v) => v.includes('.'));
      let y = x.map((v) => {
        return { name: v, id: Object.keys(allRooms[v].sockets)[0] };
      });
      return y;
    case ROOM_TYPE.OCCUPIED:
      return Object.entries(allRooms).filter((v) => v[1].length > 1);

    case ROOM_TYPE.VISITOR:
      return rooms
        .filter((v) => !v.includes('.') && v.length < 20)
        .map((v) => {
          return { name: v, id: Object.keys(allRooms[v].sockets)[0] };
        });
  }
};
const exposeAvailableRooms = (socket) => {
  try {
    let rooms = getRooms(ROOM_TYPE.AVAILABLE);
    io.to(socket.id).emit('availableRoomsExposed', rooms);
  } catch (error) {
    console.error(error);
  }
};

const exposeOccupiedRooms = (socket) => {
  try {
    let rooms = getRooms(ROOM_TYPE.OCCUPIED);
    io.to(socket.id).emit('occupiedRoomsExposed', rooms);
  } catch (error) {
    console.error(error);
  }
};

const exposeVisitorsRooms = (socket) => {
  try {
    let rooms = getRooms(ROOM_TYPE.VISITOR);
    io.to(socket.id).emit('visitorsRoomsExposed', rooms);
  } catch (error) {
    console.error(error);
  }
};

const listOccupiedRooms = () => {
  // publicRooms is the entries array of rooms
  publicRooms = getRooms(ROOM_TYPE.OCCUPIED);
  console.log(getNow(), 'All accupied Rooms (array)');
  console.table(publicRooms);
  let sockets = publicRooms.map((r) => r[1].sockets).map((v) => Object.keys(v));
  console.log('Occupying Sockets:');
  console.table(sockets);
  console.log();
};

const updateAvailableRooms = () => {
  let availableRooms = getRooms(ROOM_TYPE.AVAILABLE);
  console.info(getNow(), 'emitting availableRooms event with:');
  console.table(availableRooms);
  io.of(namespace).emit('availableRooms', availableRooms);
  console.log();
};

const updateOccupancy = (room) => {
  let r = io.nsps[namespace].adapter.rooms[room];
  if (!r) {
    return 0;
  }
  let entries = Object.entries(r);
  let occupancy = entries[1][1];
  io.of(namespace).emit('updatedOccupancy', {
    room: room,
    occupancy: occupancy,
  });
};
// Heavy lifting below
//=============================================================================//
// called when a connection changes
io.on('connection', function (socket) {
  console.log(socket.id, 'connected');

  //Alerts
  // Server handles two incoming alerts:
  //   exposureWarning
  //   alertVisitor

  // For each Room occupied, Visitor sends exposureWarning with the visit date
  // (see Visitor.vue:warnRooms())
  // message: {roomId, date}
  // Server forwards message to Room
  // Room handles notifyRoom event
  socket.on('exposureWarning', function (message, ack) {
    // Visitor message includes the Room name to alert
    let date = M(message.sentTime).format('llll');
    let availableRooms = getRooms(ROOM_TYPE.AVAILABLE);
    if (availableRooms.includes(message.room)) {
      console.table(availableRooms);
      // pass message.room because more than one room may use the same socket (e.g., an iPad may be used in the Cafe and the Galley).
      io.to(message.room).emit('notifyRoom', {
        date: date,
        room: message.room,
      });
      let msg = `Server: ${message.room} warned of possible exposure from ${date}`;
      ack(msg);
      console.info(`${getNow()} ${msg}`);
    } else {
      console.info('Current Available Visitors:');
      console.table(getRooms(ROOM_TYPE.VISITOR));
      console.warn(`${message.room} is not available to be warned`);

      // update map for later warning when message.room (aka Visitor) logs in
      unavailableRooms.set(message.room, new Date());
      console.info('Current Unavailable Visitors:');
      console.table(unavailableRooms);
    }
  });

  // sent from Room for each visitor (who warned each Room Visitor occupied)
  socket.on('alertVisitor', function (message, ack) {
    // Visitor message includes the Room names to alert
    try {
      console.info(message.visitor, 'alerted');
      socket.to(message.visitor).emit('exposureAlert', message.message);
      ack(`Server: Alerted ${message.visitor}`);
    } catch (error) {
      console.error(error);
    }
  });

  // Admin events (for Room managers use)
  socket.on('exposeOccupiedRooms', () => {
    exposeOccupiedRooms(socket);
  });
  socket.on('exposeAvailableRooms', () => {
    exposeAvailableRooms(socket);
  });
  socket.on('exposeVisitorsRooms', () => {
    exposeVisitorsRooms(socket);
  });

  // Visitors
  // Visitor sends this message
  // disambiguate enterRoom event from the event handler in the Room, checkIn
  socket.on('enterRoom', function (data) {
    if (!getRooms(ROOM_TYPE.VISITOR).includes(data.visitor)) {
      console.log(`${data.visitor}'s room is empty. Reopening now.`);
      socket.join(data.visitor);
    }

    socket.visitor = data.visitor;
    socket.payload = data;

    // Enter the Room. As others enter, you will see a notification they, too, joined.
    socket.join(data.room);
    console.log('After entering room, all occupied rooms:');
    listOccupiedRooms();

    console.log(
      '-------------------------------------------------------------------'
    );
    // handled by Room.checkIn()
    io.to(data.room).emit('checkIn', {
      visitor: data.visitor,
      sentTime: data.sentTime,
      room: data.room,
      message: data.message,
      socketId: socket.id,
    });

    updateOccupancy(data.room);
    exposeVisitorsRooms(socket);
  });

  // disambiguate leaveRoom event from the event handler in the Room, checkOut
  socket.on('leaveRoom', function (data, ack) {
    // handled by Room.checkOut()
    io.to(data.room).emit('checkOut', {
      visitor: data.visitor,
      sentTime: data.sentTime,
      room: data.room,
      message: data.message,
    });
    updateOccupancy(data.room);

    socket.leave(data.room);
    console.log(
      `Sockets in ${data.visitor}'s Room: `,
      io.nsps[namespace].adapter.rooms[data.visitor]
    );
    console.log('After leaving room, remaining occupied:');
    listOccupiedRooms();
    exposeVisitorsRooms(socket);
  });

  // called when a Visitor's room is closed or disconnected
  socket.on('openMyRoom', function (visitor, ack) {
    console.log(`Opening ${visitor}'s Room`);
    socket.join(visitor);
    console.log(io.nsps[namespace].adapter.rooms[visitor]);
    console.log();
    ack(`Server says "Your room is ready to receive messages, ${visitor}"`);
    let availableRooms = getRooms(ROOM_TYPE.AVAILABLE);
    io.to(socket.id).emit('availableRooms', availableRooms);
    console.log(`Updating ${visitor}/${socket.id} with availableRooms:`);
    console.table(availableRooms);
    console.log();
    exposeVisitorsRooms(socket);
  });

  // Rooms
  socket.on('openRoom', function (data, ack) {
    try {
      socket.room = data.room;
      console.log(getNow(), 'socket.id opening:>> ', socket.room, socket.id);
      socket.join(data.room);
      ack({
        message: `${data.room}, you are open for business. Keep your people safe today.`,
        error: '',
      });
      // updateAvailableRooms();
      let availableRooms = getRooms(ROOM_TYPE.AVAILABLE);
      console.table('availableRooms:', availableRooms);
      // handled by Visitor.availableRooms()
      io.of(namespace).emit('availableRooms', availableRooms);
      exposeAvailableRooms(socket);
    } catch (error) {
      console.error('Oops, openRoom() hit this:', error.message);
    }
  });

  socket.on('closeRoom', function (data, ack) {
    try {
      console.log('socket.id closing:>> ', socket.id);
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
      updateAvailableRooms();
      exposeAvailableRooms(socket);
    } catch (error) {
      console.error('Oops, closeRoom() hit this:', error.message);
    }
  });

  socket.on('pingServer', function (data, ack) {
    ack(`Server is at your disposal, ${data}`);
  });

  socket.on('listAllSockets', (data, ack) => {
    console.log('All open connections:');
    console.log(Object.keys(io.sockets.clients().connected));
    if (ack) ack(Object.keys(io.sockets.clients().connected));
  });

  socket.on('disconnect', () => {
    console.log(getNow(), `Disconnecting Socket ${socket.id} `);
  });

  socket.on('disconnectAll', () => {
    Object.values(io.sockets.clients().connected).map((v) => v.disconnect());
    console.log('Remaining connections :>> ', io.sockets.connected);
  });
});

http.listen(port, function () {
  console.log('Build: 09.07.14.15'.magenta);
  console.log(M().format('llll').magenta);
  console.log(`listening on http://localhost: ${port}`.magenta);
  console.log();
});
