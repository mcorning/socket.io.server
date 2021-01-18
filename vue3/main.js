const socket = io();

socket.on('connect', () => {
  this.socketId = socket.id;

  alert(this.socketId);
});
