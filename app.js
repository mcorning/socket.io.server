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

// Server helper methods
// called by event handlers: enterRoom and openRoom
// current socket joins room specified by client
const joinRoom = (socket, room) => {
  socket.join(room, () => {
    let rooms = Object.keys(socket.rooms);
    console.log(getNow());
    console.log(
      `Rooms occupied by ${socket.visitor} after they joined ${room} (includes Visitor's own room):`
        .blue
    );

    console.table(rooms);
    console.log(
      '-------------------------------------------------------------------'
    );
    updateOccupancy(room);
  });
};

// called by event handlers: leaveRoom (Visitor) and closeRoom (Room)
// current socket leaves room specified by client
const leaveRoom = (socket, room) => {
  socket.leave(room, () => {
    let rooms = Object.keys(socket.rooms);
    console.log(getNow());
    console.log(
      `Rooms occupied by ${socket.visitor} after they left ${room}
(includes Visitor's own room):`.yellow
    );

    console.table(rooms);
    console.log(
      '-------------------------------------------------------------------'
    );
    updateOccupancy(room);
  });
};

let namespace = '/';

const getNow = () => {
  return M().format('HH:MM MMM DD');
};

const updateAvailableRooms = () => {
  let availableRooms = Array.from(
    Object.keys(io.nsps[namespace].adapter.rooms)
  ).filter((room) => room.includes('.'));
  console.table(availableRooms);

  io.of(namespace).emit('availableRooms', availableRooms);
};

const updateOccupancy = (room) => {
  // this does not appear to be sent to all in the room
  const occupiedRoom = io.nsps[namespace].adapter.rooms[room];
  const occupancy = occupiedRoom ? Object.keys(occupiedRoom).length : 0;
  console.log(`${getNow()}: Now ${room} has ${occupancy} occupants`);
  // io.in(room).send(`Server: Occupancy ${occupancy}`);

  listAllRooms();
};

const listAllRooms = () => {
  // console.log('To include all rooms on the Server:');
  console.log();
  console.log(`Listing all rooms in namespace ${namespace} `);
  console.table(io.nsps[namespace].adapter.rooms);
};

// Heavy lifting below
//=============================================================================//
// called when a connection changes
io.on('connection', function (socket) {
  console.log(
    `//====================== on connection() ======================//`
  );
  console.log(
    `When ${socket.id} connected, these rooms were in namespace ${namespace} 
(including a room named with visitor's ID,  ${socket.id}): `
  );
  console.table(io.nsps[namespace].adapter.rooms);
  console.log(
    `//==================== end on connection() ====================//
    `
  );

  socket.on('pingServer', function (data, ack) {
    ack(`Server is at your disposal, ${data}`);
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
    io.to(message.room).emit('notifyRoom', date);
    let msg = `Server: ${message.room} warned of possible exposure from ${date}`;
    ack(msg);
    console.info(`${getNow()} ${msg}`);
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
    socket.visitor = data.visitor;
    socket.payload = data;

    // Enter the Room. As others enter, you will see a notification they, too, joined.
    joinRoom(socket, data.room);

    // handled by Room.checkIn()
    io.to(data.room).emit('checkIn', {
      visitor: data.visitor,
      sentTime: data.sentTime,
      room: data.room,
      message: data.message,
      socketId: socket.id,
    });
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

    leaveRoom(socket, data.room);
  });

  // Rooms
  socket.on('openRoom', function (data, ack) {
    try {
      socket.room = data.room;
      console.log(getNow(), 'socket.id opening:>> ', socket.room, socket.id);
      joinRoom(socket, socket.room);
      ack({
        message: `${data.room}, you are open for business. Keep your people safe today.`,
        error: '',
      });

      updateAvailableRooms();
    } catch (error) {
      console.error('Oops, openRoom() hit this:', error.message);
    }
  });

  socket.on('closeRoom', function (data, ack) {
    try {
      console.log('socket.id closing:>> ', socket.room, socket.id);
      leaveRoom(socket, socket.room);
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
  console.log('Build: 09.02.20.25'.magenta);
  console.log(M().format('llll').magenta);
  console.log(`listening on http://localhost: ${port}`.magenta);
  console.log();
});
