const SOURCE = {
  SERVER: 'server',
  VISITOR: 'visitor',
  ROOM: 'room',
  ADMIN: 'admin',
};
const ROOM_TYPE = {
  RAW: 0,
  AVAILABLE: 1,
  OCCUPIED: 2,
  VISITOR: 4,
  PENDING: 8,
};
module.exports = {
  SOURCE,
  ROOM_TYPE,
};
