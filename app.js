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
  RAW: 0,
  AVAILABLE: 1,
  OCCUPIED: 2,
  VISITOR: 4,
};
// Server helper methods
const getNow = () => {
  return M().format('lll');
};

const getRooms = (roomType) => {
  if (!io.nsps[namespace]) {
    console.error(`${namespace} is invalid. Reset to default "/" value.`);
    namespace = '/';
  }
  const allRooms = io.nsps[namespace].adapter.rooms;

  if (roomType == ROOM_TYPE.RAW) {
    return allRooms;
  }

  let rooms;
  switch (roomType) {
    case ROOM_TYPE.AVAILABLE:
      rooms = Object.keys(allRooms)
        .filter((v) => v.includes('.'))
        .map((v) => {
          return { name: v, id: Object.keys(allRooms[v].sockets)[0] };
        });
      console.log('Available Rooms:');
      console.table(rooms);
      io.of(namespace).emit('availableRoomsExposed', rooms);
      return rooms;

    case ROOM_TYPE.OCCUPIED:
      rooms = Object.entries(allRooms).filter(
        (v) => v[0].includes('.') && v[1].length > 1
      );
      console.log('Occupied Rooms:');
      console.table(rooms);
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
    // io.of(namespace).emit('occupiedRoomsExposed', occupied);
    io.of(namespace).emit('updatedOccupancy', {
      room: room,
      occupancy: occupancy,
    });
  }
  // here getRooms() will fire visitorsRoomsExposed event so Admin sees updated list of Visitors
  let otherVisitors = getRooms(ROOM_TYPE.VISITOR);
  console.log('Other Visitors');
  console.table(otherVisitors);
  console.log();
};

// Heavy lifting below
//=============================================================================//
// called when a connection changes
io.on('connection', function (socket) {
  console.log(socket.id, 'connected');

  socket.on('welcomeAdmin', (nsp, ack) => {
    console.log(getNow(), 'namespace before:', namespace);
    //namespace = nsp;
    console.log(getNow(), 'namespace after:', namespace);
    console.log();
    ack(`Server is using namespace: ${namespace}`);
  });

  //Alerts
  // Server handles two incoming alerts:
  //   alertVisitor...

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

  // ...exposureWarning
  // For each Room occupied, Visitor sends exposureWarning with the visit date
  // (see Visitor.vue:warnRooms())
  // message: {roomId, date}
  // Server forwards message to Room
  // Room handles notifyRoom event
  socket.on('exposureWarning', function (message, ack) {
    // Visitor message includes the Room name to alert
    let date = M(message.sentTime).format('llll');
    let availableRooms = getRooms(ROOM_TYPE.AVAILABLE);
    console.log('Available Rooms:');
    console.table(availableRooms);

    if (availableRooms.filter((v) => v.name == message.room)) {
      // pass message.room because more than one room may use the same socket (e.g., an iPad may be used in the Cafe and the Galley).
      io.to(message.room).emit('notifyRoom', {
        exposureDate: new Date(date).toISOString(),
        room: message.room,
      });
      let msg = `Server: ${message.room} warned of possible exposure from ${date}`;
      ack(msg);
      console.info(`${getNow()} ${msg}`);
    } else {
      // console.info('Current Available Visitors:');
      // console.table(getRooms(ROOM_TYPE.VISITOR));
      // console.warn(`${message.room} is not available to be warned`);

      // update map for later warning when message.room (aka Visitor) logs in
      unavailableRooms.set(message.room, new Date());
      console.info('Current Unavailable Rooms:');
      console.table(unavailableRooms);
    }
  });

  // Admin events (for Room managers use)
  socket.on('exposeOccupiedRooms', () => {
    getRooms(ROOM_TYPE.OCCUPIED);
  });
  socket.on('exposeAvailableRooms', () => {
    getRooms(ROOM_TYPE.AVAILABLE);
  });
  socket.on('exposeVisitorsRooms', () => {
    getRooms(ROOM_TYPE.VISITOR);
  });

  // Visitors
  // called when a Visitor's room is closed or disconnected
  socket.on('openMyRoom', function (visitor, ack) {
    socket.join(visitor);

    console.log(`Opened ${visitor}'s Room`);
    console.log(getRooms(ROOM_TYPE.RAW)[visitor]);
    console.log();
    ack(`Server says "Your room is ready to receive messages, ${visitor}"`);

    updateOccupancy();
    // // getRooms() will fire availableRoomsExposed event so Visitor sees updated list of Rooms
    // let availableRooms = getRooms(ROOM_TYPE.AVAILABLE);
    // // io.to(socket.id).emit('availableRooms', availableRooms);
    // console.log(`Updating ${visitor}/${socket.id} with availableRooms:`);
    // console.table(availableRooms);
    // console.log();

    // // here getRooms() will fire visitorsRoomsExposed event so Admin sees updated list of Visitors
    // let otherVisitors = getRooms(ROOM_TYPE.VISITOR);
    // console.log('Other Visitors');
    // console.table(otherVisitors);
    // console.log();
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
    socket.leave(data.room);

    // handled by Room.checkOut()
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
      socket.room = data.room;
      console.log(getNow(), 'socket.id opening:>> ', socket.room, socket.id);
      socket.join(data.room);
      ack({
        message: `${data.room}, you are open for business. Keep your people safe today.`,
        error: '',
      });

      getRooms(ROOM_TYPE.AVAILABLE);
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
      // updateAvailableRooms();
      exposeAvailableRooms(socket);
    } catch (error) {
      console.error('Oops, closeRoom() hit this:', error.message);
    }
  });

  socket.on('pingServer', function (data, ack) {
    ack(`Server is at your disposal, ${data}`);
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
  console.log('Build: 09.14.20.13'.magenta);
  console.log(M().format('llll').magenta);
  console.log(`listening on http://localhost: ${port}`.magenta);
  console.log();
});
