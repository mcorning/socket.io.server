// express code
var express = require('express');
var app = express();

var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3003;

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
      `Rooms occupied by ${socket.visitor} after they left ${room} (includes Visitor's own room):`
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

const updateOccupancy = (room) => {
  // this does not appear to be sent to all in the room
  const occupiedRoom = io.nsps[namespace].adapter.rooms[room];
  const occupancy = occupiedRoom ? Object.keys(occupiedRoom).length : 0;
  console.log(`${getNow()}: Now ${room} has ${occupancy} occupants`);
  // io.in(room).send(`Server: Occupancy ${occupancy}`);

  getAllRooms();
};

const getAllRooms = () => {
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
    `//======================== on connection() ========================//`
  );
  console.log(
    `When ${socket.id} connected, these rooms were in namespace ${namespace}: `
  );
  console.table(io.nsps[namespace].adapter.rooms);
  console.log(
    `//====================== end on connection() ======================//
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
    let date = M(message.sentTime).format('MMM DD');
    io.to(message.room).emit('notifyRoom', date);
    let msg = `Server notified ${message.room} of possible exposure on ${date}`;
    ack(msg);
    console.info(`${getNow()} ${msg}`);
  });

  // sent from Room for each visitor (who warned each Room Visitor occupied)
  socket.on('alertVisitor', function (message, ack) {
    // Visitor message includes the Room names to alert
    try {
      console.info(message.visitor, 'alerted');
      socket.to(message.visitor).emit('exposureAlert', message.message);
      ack(`Alerted Visitor`);
    } catch (error) {
      console.error(error);
    }
  });

  // Visitors
  // Visitor sends this message
  socket.on('enterRoom', function (data) {
    socket.visitor = data.visitor;
    socket.payload = data;

    // add this socketId from the Visitor to all others used.
    // this way you can map all connnected sockets to individual Visitors
    // To alert this visitor, send the Alerts to this room (lower case to distinguish from real Rooms).
    socket.join(data.visitor);

    // Enter the Room. As others enter, you will see a notification they, too, joined.
    joinRoom(socket, data.room);

    // disambiguate enterRoom event from the event handler in the Room, checkIn
    // handled by Room.checkIn()
    io.to(data.room).emit('checkIn', {
      visitor: data.visitor,
      sentTime: data.sentTime,
      room: data.room,
      message: data.message,
      socketId: socket.id,
    });
  });

  socket.on('leaveRoom', function (data, ack) {
    // disambiguate enterRoom event from the event handler in the Room, checkOut
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
        message: `You are open for business, ${data.room}. Keep your people safe today.`,
        error: '',
      });
      io.of(namespace).emit('roomIsAvailable', data.room);
    } catch (error) {
      ack({ message: 'Oops, openRoom() hit this:', error: error.message });
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
        message: `Well done, ${socket.room}. See you tomorrow?`,
        error: '',
      });
    } catch (error) {
      ack({ message: 'Oops, closeRoom() hit this:', error: error.message });
    }
  });

  // can't we disconnect in the client?
  socket.on('removeRoom', () => {
    socket.disconnect();
  });
  socket.on('removeVisitor', () => {
    socket.disconnect();
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

  // socket.emit('newMessage', 'I am here');

  // socket.on('newMessage', function (msg) {
  //   console.info('new message', msg);
  //   if (msg.message == 'alert') {
  //     console.error(msg.visitor + 'is quarantived on', msg.sentTime);
  //   }
  //   io.emit('newMessage', msg);
  // });

  // // called when Visitor changes Room dropdown
  // socket.on('joinRoom', (data) => {
  //   console.log(data);
  //   socket.join(data);
  //   io.to(data).emit('newMessage', 'Welcome our new visitor');
  // });

  // // Called inside room.created(),
  // socket.on('addRoom', (data) => {
  //   console.log(data);
  //   rooms.push(data);
  //   socket.emit('addedRoom', { numRooms: rooms.size, roomId: data });
  // });
});

http.listen(port, function () {
  console.log('Build: 09.0118.12');
  console.log('listening on http://localhost:' + port);
});
