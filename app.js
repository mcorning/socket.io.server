var express = require('express');
var app = express();

var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', function (req, res) {
  res.sendFile(__dirname + '/index.html');
});

let rooms = new Map();
let visitors = new Map();

// This server handles messages from Rooms and Visitors
// Rooms
// Room comes onine and gets connected to server
// Room's mounted lifecycle method updates the server with its Room ID and the 'open' event
// NOTE: Rooms may be managed by a person. If so, they may be subject to an exposure alert (or they may trigger one)

io.on('connection', function (socket) {
  visitors.set(socket.id, '');
  console.log(socket.id, 'connected');
  console.log('ROOMS:', rooms);

  // Rooms
  socket.on('open', function (roomId, cb) {
    cb({
      msg: `Keep your people safe today, ${roomId}`,
      socketId: socket.id,
    });
    socket.join(roomId);
    console.log(new Date(), 'opening', roomId);
    rooms.set(socket.id, roomId);
    console.log('ROOMS:', rooms);
  });

  socket.on('close', function (roomId, cb) {
    cb({
      msg: `Well done, ${roomId}`,
      socketId: socket.id,
    });
    socket.leave(data.roomId);
    console.log(data, 'closing.');
    rooms.set(socket.id, roomId);
  });

  // Visitors
  socket.on('enterRoom', function (data, cb) {
    cb({
      msg: `Welcome to ${data.roomId}, ${data.yourId}.`,
      socketId: socket.id,
    });
    socket.join(data.roomId);
    console.log(new Date(), data.message);
    visitors.set(socket.id, data.yourId);
    console.log(visitors);
    // disambiguate enterRoom event from the event handler in the Room, check-in
    io.to(data.roomId).emit('check-in', {
      visitor: data.yourId,
      sentTime: data.sentTime,
      socketId: socket.id,
    });
  });

  socket.on('leaveRoom', function (data, cb) {
    cb(`See you next time, ${data.yourId}`);
    console.log(new Date(), visitors.get(socket.id), 'has left the building');

    // departed handled by Room to list the timestamped departure
    io.to(data.roomId).emit('check-out', {
      visitor: data.yourId,
      sentTime: data.sentTime,
      socketId: socket.id,
    });
    socket.leave(data.roomId);
  });

  socket.on('removeRoom', () => {
    rooms.delete(socket.id);
    socket.disconnect();
  });
  socket.on('removeVisitor', () => {
    visitors.delete(socket.id);
    console.log(new Date(), visitors);
    socket.disconnect();
  });

  socket.on('disconnect', () => {
    console.log(
      new Date(),
      `Disconnecting Socket ${socket.id} (${visitors.get(socket.id)})`
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
