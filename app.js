var express = require('express');
var app = express();

var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3000;

const M = require('moment');

app.use(express.static(__dirname));

app.get('/', function (req, res) {
  res.sendFile(__dirname + '/index.html');
});

// let roomMap = new Map();
// let visitorMap = new Map();
// let alertMap = new Map('', []);

// let updateAlertMap = function (data) {
//   if (!alertMap.has(data.visitor)) {
//     alertMap.set(data.visitor, []);
//   }
//   alertMap.get(data.visitor).push({ room: data.room, date: data.sentTime });
//   // console.log('Alert Map', alertMap);
// };

// This server handles messages from Rooms and Visitors
// Rooms
// Room comes onine and gets connected to server
// Room's mounted lifecycle method updates the server with its Room ID and the 'open' event
// NOTE: Rooms may be managed by a person. If so, they may be subject to an exposure alert (or they may trigger one)
// join() called by alertRooms() and on('open') to add a socket to a Room
const joinRoom = (socket, room) => {
  socket.join(room, () => {
    // use if extra processing needed
    let rooms = Object.keys(socket.rooms);
    console.log(new Date(), 'Rooms after socket joined:');
    console.log(rooms);
  });
};
const leave = (socket, room) => {
  socket.leave(room, () => {
    let rooms = Object.keys(socket.rooms);
    console.log(
      new Date(),
      `Rooms after socket ${socket.id} (${socket.room})left:`
    );
    console.log(rooms);
  });
};

function alertVisitor(value, key) {
  console.log(`Alerting ${value} on socket ${key}`);
  io.to(key).emit('exposureAlert', `${value}, you may have been exposed.`);
}

// Heavy lifting below
//===================================================================================//

io.on('connection', function (socket) {
  socket.on('pingServer', function (data, ack) {
    ack(`Server is at your disposal, ${data}`);
  });

  //Alerts
  // Server handles two incoming alerts:
  //   exposureWarning
  //   alertVisitor

  // For each Room occupied, Visitor sends exposureWarning with the visit dates
  // (see Visitor.vue:warnRooms())
  // message: {roomId, [dates]}
  // Server forwards message to Room
  // Room handles notifyRoom event
  socket.on('exposureWarning', function (message, ack) {
    // Visitor message includes the Room name to alert
    io.to(message.room).emit('notifyRoom', message.message);
    let dates = message.message.map((v) => M(v.sentTime).format('MMM DD'));
    console.log('dates :>> ', dates);
    ack(`Server notified ${message.room} of possible exposure on ${dates}`);
  });

  // sent from Room for each visitor (who warned each Room Visitor occupied)
  socket.on('alertVisitor', function (message, ack) {
    // Visitor message includes the Room names to alert
    try {
      message.visitor.map((v) => {
        socket.to(message.visitor).emit('exposureAlert', message.message);
      });
      ack(`Alerted Visitor`);
    } catch (error) {
      console.error(error);
    }
  });

  // Visitors
  // Visitor sends this message
  socket.on('enterRoom', function (data, ack) {
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
      socketId: socket.id,
    });
    io.in(data.room).send('Visitor entered Room');
    if (ack) {
      ack(1);
    }
  });

  socket.on('leaveRoom', function (data, ack) {
    // disambiguate enterRoom event from the event handler in the Room, checkOut
    // handled by Room.checkOut()
    io.to(data.room).emit('checkOut', {
      visitor: data.visitor,
      sentTime: data.sentTime,
    });

    io.in(data.room).send('Visitor left Room');
    if (ack) {
      ack(-1);
    }
    leave(socket, data.room);
  });

  // Rooms
  socket.on('openRoom', function (data, ack) {
    try {
      socket.room = data.room;
      console.log(new Date(), 'socket.id opening:>> ', socket.room, socket.id);
      joinRoom(socket, socket.room);
      ack({
        message: `You are open for business, ${data.room}. Keep your people safe today.`,
        error: '',
      });
    } catch (error) {
      ack({ message: 'Oops, openRoom() hit this:', error: error.message });
    }
  });

  socket.on('closeRoom', function (data, ack) {
    try {
      console.log('socket.id closing:>> ', socket.room, socket.id);
      leave(socket, socket.room);
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
    console.log(new Date(), `Disconnecting Socket ${socket.id} `);
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
  console.log('listening on *:' + port);
});
