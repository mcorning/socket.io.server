var express = require('express');
var app = express();

var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', function (req, res) {
  res.sendFile(__dirname + '/index.html');
});

let roomMap = new Map();
let visitorMap = new Map();
let alertMap = new Map();

// This server handles messages from Rooms and Visitors
// Rooms
// Room comes onine and gets connected to server
// Room's mounted lifecycle method updates the server with its Room ID and the 'open' event
// NOTE: Rooms may be managed by a person. If so, they may be subject to an exposure alert (or they may trigger one)
const join = (socket, value) => {
  socket.join(value, () => {
    let rooms = Object.keys(socket.rooms);
    console.log(new Date(), 'Rooms after socket joined:');
    console.log(rooms);
    console.log('Visitors:');
    console.log(visitorMap);
  });
};
const leave = (socket, value) => {
  socket.leave(value, () => {
    let rooms = Object.keys(socket.rooms);
    console.log(new Date(), 'Rooms after socket joined:');
    console.log(rooms);
    console.log('Visitors:');
    console.log(visitorMap);
  });
};

io.on('connection', function (socket) {
  console.log(socket.id, 'connected');
  console.log('roomMap:', roomMap);

  //Alerts
  socket.on('alert', function (data, cb) {
    cb({
      msg: `Notifying all rooms you occupied in last 14 days`,
      socketId: socket.id,
    });
    roomMap.set(socket.id, data.room);
    join(socket, data.room);
    io.to(data.room).emit('exposureAlert', {
      visitor: data.visitor,
      sentTime: data.sentTime,
      socketId: socket.id,
    });
  });
  // Rooms
  socket.on('open', function (data, cb) {
    cb({
      msg: `Keep your people safe today, ${data.room}`,
      socketId: socket.id,
    });
    roomMap.set(socket.id, data.room);
    join(socket, data.room);
    console.log(new Date(), 'opening', data.room);
    console.log('ROOMS:', roomMap);
  });

  socket.on('close', function (data, cb) {
    cb({
      msg: `Well done, ${data.room}`,
      socketId: socket.id,
    });
    leave(socket, data.room);
    if (roomMap.has(socket.id)) {
      console.log(
        `${data.room} ${roomMap.delete(socket.id) ? 'closed' : 'cannot close'}.`
      );
    } else {
      console.log(`Cannot find socket ${socket.id}`);
    }
  });

  // Visitors
  socket.on('enterRoom', function (data, cb) {
    cb({
      socketId: socket.id,
    });
    socket.join(data.room);
    console.log(new Date(), data.message);
    visitorMap.set(socket.id, data.visitor);
    console.log(visitorMap);
    // disambiguate enterRoom event from the event handler in the Room, check-in
    // handled by Room.handleMessage()
    io.to(data.room).emit('check-in', {
      visitor: data.visitor,
      sentTime: data.sentTime,
      socketId: socket.id,
    });
  });

  socket.on('leaveRoom', function (data, cb) {
    cb({ roomId: data.room, visitor: data.visitor, socketId: socket.id });
    console.log(new Date(), visitorMap.get(socket.id), 'has left the building');

    // departed handled by Room to list the timestamped departure
    io.to(data.room).emit('check-out', {
      visitor: data.visitor,
      sentTime: data.sentTime,
      socketId: socket.id,
    });
    socket.leave(data.room);
  });

  socket.on('removeRoom', () => {
    roomMap.delete(socket.id);
    socket.disconnect();
  });
  socket.on('removeVisitor', () => {
    visitorMap.delete(socket.id);
    console.log(new Date(), visitorMap);
    socket.disconnect();
  });

  socket.on('disconnect', () => {
    console.log(
      new Date(),
      `Disconnecting Socket ${socket.id} (${visitorMap.get(socket.id)})`
    );
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
