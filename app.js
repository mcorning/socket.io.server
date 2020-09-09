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

// Server helper methods
const getNow = () => {
  return M().format('lll');
};

const getRooms = (available = false, accupied = false) => {
  const allRooms = io.nsps[namespace].adapter.rooms;
  let rooms = Object.keys(allRooms);
  if (available) {
    return rooms.filter((v) => v.includes('.'));
  }
  if (accupied) {
    return Object.entries(allRooms).filter((v) => v[1].length > 1);
  }
  return rooms;
};

const listOccupiedRooms = () => {
  // publicRooms is the entries array of rooms
  publicRooms = getRooms(null, true);
  console.log(getNow(), 'All accupied Rooms (array)');
  console.table(publicRooms);
  let sockets = publicRooms.map((r) => r[1].sockets).map((v) => Object.keys(v));
  console.log('Occupying Sockets:');
  console.table(sockets);
  console.log();
};

const updateAvailableRooms = () => {
  let availableRooms = getRooms(true);
  console.info(getNow(), 'emitting availableRooms event with:');
  console.table(availableRooms);
  io.of(namespace).emit('availableRooms', availableRooms);
  console.log();
};
const updateOccupancy = (room) => {
  let r = Object.entries(io.nsps[namespace].adapter.rooms[room]);
  let occupancy = r[1][1];
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

  socket.on('openMyRoom', function (visitor, ack) {
    console.log(`Opening ${visitor}'s Room`);
    socket.join(visitor);
    console.log(io.nsps[namespace].adapter.rooms[visitor]);
    console.log();
    ack(`Server says "Your room is ready to receive messages, ${visitor}"`);
    io.to(socket.id).emit('availableRooms', getRooms(true));
  });

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
    let availableRooms = getRooms(true);
    if (availableRooms.includes(message.room)) {
      console.table(availableRooms);
      io.to(message.room).emit('notifyRoom', date);
      let msg = `Server: ${message.room} warned of possible exposure from ${date}`;
      ack(msg);
      console.info(`${getNow()} ${msg}`);
    } else {
      console.table(getRooms());

      console.warn(`${message.room} is not available to be warned`);
      unavailableRooms.set(message.room, new Date());
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

  // Visitors
  // Visitor sends this message
  // disambiguate enterRoom event from the event handler in the Room, checkIn
  socket.on('enterRoom', function (data) {
    if (!getRooms().includes(data.visitor)) {
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
      let availableRooms = getRooms(true);
      console.table('availableRooms:', availableRooms);
      // handled by Visitor.availableRooms()
      io.of(namespace).emit('availableRooms', availableRooms);
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
