const moment = require('moment');

const clc = require('cli-color');
const success = clc.red.green;
const error = clc.red.bold;
const warn = clc.yellow;
const info = clc.cyan;
const highlight = clc.magenta;
// globals
let namespace = '/';

const getNow = () => {
  return moment().format('HH:mm:ss:SSS:');
};

function printJson(json) {
  return JSON.stringify(json, null, 3);
}

const logResults = (function () {
  let logResults = [];
  let title = 'Log Results';
  let collapsed = true;

  function entry(message) {
    {
      this.time = moment().format('HH:mm:ss:SSS');
      this.message = message.text;
      this.level = message.level || 0;
      this.type = message.type || 'output';
    }
  }

  return {
    hasData: function () {
      return logResults.length;
    },

    entitle: function (caption, collapsed = true) {
      if (!this.hasData()) title = caption;
      this.collapsed = collapsed;
    },

    //{type:'', level:'', date:'', message:''}
    add: function (e) {
      logResults.push(new entry(e));
    },

    clear: function () {
      logResults = [];
    },

    show: function (clear = true) {
      if (this.collapsed) {
        console.groupCollapsed(title);
      } else {
        console.group(title);
      }
      console.table(logResults);
      console.groupEnd();
      if (clear) {
        logResults = [];
      }
    },
  };
})();

class ServerProxy {
  constructor(io) {
    this.io = io;
    this.pendingRoomAlerts = new Map();
    this.pendingVisitorWarnings = new Map();
  }

  get sockets() {
    return Object.entries(this.io.nsps[namespace].adapter.nsp.sockets).reduce(
      (a, c) => {
        let query = c[1].handshake.query;
        let b = {
          id: c[0],
          room: query.room,
          visitor: query.visitor,
          namespace: query.nsp,
          connected: c[1].connected,
          occupiedRooms: c[1].rooms,
        };
        a.push(b);
        return a;
      },
      []
    );
  }

  get rawSockets() {
    let x = [...Object.entries(this.io.nsps[namespace].adapter.nsp.sockets)];
    return x;
  }

  // online sockets that represent Rooms
  get available() {
    return this.sockets.filter((v) => v.room);
  }

  // includes sockets with generated IDs and given IDs
  // note: the latter implies the former
  // so a Room can be absent in this list even if its room
  // remains online
  // also, Visitors also have rooms with generated IDs
  // but they will appear visitors (below), and not in rooms
  get rooms() {
    return this.io.nsps[namespace].adapter.rooms;
  }

  // online sockets that represent Visitors
  get visitors() {
    return this.sockets.filter((v) => v.visitor);
  }

  // online Rooms (a Room)
  get openRooms() {
    let a = this.available;
    let o = this.rooms;
    return a.filter((v) => o[v.room]);
  }

  getSocket(id) {
    return this.io.nsps[namespace].adapter.nsp.sockets[id];
  }

  isOpen(id) {
    return this.openRooms.filter((v) => v.id == id).length;
  }

  getOccupancy(room) {
    if (!room) {
      throw 'No room name specified';
    }
    return this.rooms[room].length;
  }

  // called by server.onExposureWarning and server.onAlertVisitor
  sendOrPend(data) {
    const { event, reason, visitor, room, exposureDates } = data;
    if (event == 'exposureAlert') {
      //#region this.visitors data structure
      // Ensure Visitor is online to see alert, otherwise cache and send when they login again
      // this.visitors has this structure:
      // [
      //   {
      //     id: '-DfaxawFa31U2rn2AAAB',
      //     visitor: 'MichaelUK',
      //     uniqueName: '-DfaxawFa31U2rn2AAAB',
      //     namespace: 'enduringNet',
      //     connected: true,
      //     rooms: {
      //       '-DfaxawFa31U2rn2AAAB': '-DfaxawFa31U2rn2AAAB',
      //     },
      //   },
      //   {
      //     id: 'fhcoU6xEF-0wFmCVAAAA',
      //     visitor: 'MichaelUsa',
      //     uniqueName: 'fhcoU6xEF-0wFmCVAAAA',
      //     namespace: 'enduringNet',
      //     connected: true,
      //     rooms: {
      //       'fhcoU6xEF-0wFmCVAAAA': 'fhcoU6xEF-0wFmCVAAAA',
      //     },
      //   },
      // ];
      // so filter on the strongest predicate: ID
      // ***** NOTE: this.visitors can be empty only if all Visitors are disconnected
      // ***** So ensure a Visitor can't press the Warn Rooms button unless their socket is connected
      //#endregion
      if (this.visitors.filter((v) => v.id === visitor.id).length) {
        // sending to visitor socket in visitor's room (except sender)
        this.privateMessage(event, data);

        return 'ALERTED';
      } else {
        // cache the Visitor warning
        this.pendingRoomAlerts.set(visitor.id, data);
        console.warn(`${visitor.visitor} is offline. Caching event.`);
        console.group('Pending Warnings');
        console.log(printJson([...this.pendingRoomAlerts]));
        console.groupEnd();

        return 'PENDING';
      }
    }
    if (event == 'notifyRoom') {
      // notifyRoom expects this data:
      // {room, reason, exposureDates, visitor}

      if (this.openRooms.filter((v) => v.room == room).length) {
        this.privateMessage(event, {
          room: room,
          reason: reason,
          exposureDates: exposureDates,
          visitor: visitor,
        });

        return 'WARNED';
      } else {
        this.pendingVisitorWarnings.set(room, {
          room: room,
          reason: reason,
          visitor: visitor,
          exposureDates: exposureDates,
        });
        console.warn(`${room} is closed. Caching event.`);
        console.group('Pending Warnings');
        console.log(printJson([...this.pendingVisitorWarnings]));
        console.groupEnd();

        return 'PENDING';
      }
    }
  }

  isVisitorPending(visitorId) {
    const exposedVisitor = this.pendingRoomAlerts.get(visitorId);
    if (exposedVisitor) {
      // Visitor expects:
      // const { room, exposedVisitor } = exposure;
      const exposure = {
        room: exposedVisitor.room,
        exposedVisitor: visitorId,
      };
      // alert Visitor
      this.stepMessage(visitorId, 'stepFourServerAlertsVisitor', exposure);

      this.deletePendingVisitorWarning(visitorId, 'isVisitorPending');
    }
  }

  handlePendings(query) {
    console.log('Checking for pending warnings...');

    // handle Room
    if (query.room) {
      console.log(
        'Pending Visitor Warnings:',
        printJson([...this.pendingVisitorWarnings])
      );
      // record Room state
      query.closed = this.isOpen(query.id);

      if (!this.pendingVisitorWarnings.has(query.room)) {
        let msg = `...Nothing pending for ${query.room} (which is ${
          this.isOpen(query.id) ? 'open' : 'closed'
        }).`;
        console.log(msg);
        return msg;
      }

      console.log(
        warn(
          `Handling ${query.room}'s ${this.pendingVisitorWarnings.size} Pending Warnings:`
        )
      );
      this.pendingVisitorWarnings.forEach((value, key) => {
        // Room.vue expects this data:
        // const { exposureDates, visitor, reason, room } = data;

        this.stepMessage(query.room, 'stepTwoServerNotifiesRoom', value);
        this.pendingVisitorWarnings.delete(key);
        console.log(warn(`Deleting ${value} pending warning`));
      });
    }
    // handle Visitor or Admin
    else if (query.visitor || query.admin) {
      console.log(
        'Pending Visitor Warnings:',
        printJson([...this.pendingRoomAlerts])
      );

      if (
        !this.pendingRoomAlerts.size ||
        !this.pendingRoomAlerts.has(query.id)
      ) {
        let msg = `...Nothing pending for Visitor ${query.visitor}`;
        console.log(msg);
        return msg;
      }

      this.pendingRoomAlerts.forEach((value, key) => {
        // const message = {
        //   visitor: key,
        //   exposureDates: value.message,
        //   room: '',
        // };
        this.privateMessage('exposureAlert', value);
        this.pendingRoomAlerts.delete(key);
      });
    }
  }

  notifyRoom(data) {
    const { room } = data;
    try {
      console.group(`[${getNow()}] EVENT: notifyRoom from ${room}`);
      this.privateMessage(room, 'notifyRoom', data);
      return `${room} WARNED`;
    } catch (error) {
      console.error(error);
      return error;
    } finally {
      console.groupEnd();
    }
  }

  log() {
    let query = this.socket.handshake.query;
    if (query.room) {
      this.checkPendingRoomWarnings(query);
    }

    if (query.admin || query.visitor || query.room) {
      console.log(' ');
      console.log(
        highlight(
          moment().format('HH:mm:ss:SSS'),
          'In connection handler: Opening connection to a Room for:',
          query.admin || query.visitor || query.room,
          'using socketId:',
          query.id
        )
      );
    }

    this.openMyRoom();
  }

  // Event Heloers
  privateMessage(event, message) {
    console.info(`Emitting ${event} to ${message.room} with:`);
    console.log(printJson(message));
    console.log('Visitors', printJson(this.visitors));

    // note: cannot attach callback to namespace broadcast event
    this.io.to(message.room).emit(event, message);
  }

  roomIdsIncludeSocket(roomName, id) {
    try {
      const result = this.rooms[roomName] && this.rooms[roomName].sockets[id];
      return result;
    } catch (error) {
      console.error(error);
      console.log('Returning false');
      return false;
    }
  }

  roomIsOnline(id) {
    return this.io.nsps[namespace].adapter.nsp.sockets[id];
  }
  socketIsOnline(id) {
    return this.io.nsps[namespace].sockets[id];
  }

  exposeOpenRooms() {
    const openRooms = this.openRooms;
    this.io.of(namespace).emit('openRoomsExposed', openRooms);
    return openRooms;
  }

  exposeAvailableRooms() {
    this.io.of(namespace).emit('availableRoomsExposed', this.available);
  }

  updateOccupancy(room) {
    if (room && this.rooms[room]) {
      let occupancy = this.rooms.length || 0;
      // sending to all clients in namespace 'myNamespace', including sender
      this.io.of(namespace).emit('updatedOccupancy', {
        room: room,
        occupancy: occupancy,
      });
      return occupancy;
    }
    return 0;
  }

  emit(payload) {
    this.socket.emit(payload.event, payload.message, payload.ack);
  }

  setPendingVisitorWarning(data) {
    console.log(warn(`Adding ${data.room} to pendingVisitorWarnings Map`));
    console.log(warn(`pendingVisitorWarnings Map:`));
    this.pendingVisitorWarnings.set(data.room, data);
    console.log(warn(printJson([...this.pendingVisitorWarnings])));
    console.log(' ');
  }

  setPendingRoomAlerts(data) {
    console.log(warn(`Adding ${data.room} to pendingRoomAlerts Map`));
    console.log(warn(`pendingRoomAlerts Map:`));
    this.pendingRoomAlerts.set(data.visitorId, data);
    console.log(warn(printJson([...this.pendingRoomAlerts])));
    console.log(' ');
  }

  stepMessage(room, event, data) {
    console.log(
      success(`Emitting: ${event} to ${room} with ${printJson(data)}`)
    );
    this.io.to(room).emit(event, data);
  }

  deletePendingVisitorWarning(room, caller) {
    console.log(' ');
    console.log(warn(caller, ':'));
    console.log(warn(`Deleting ${room} to this.pendingVisitorWarnings Map`));
    this.pendingVisitorWarnings.delete(room);
    console.log(warn([...this.pendingVisitorWarnings]));
    console.log(' ');
  }

  deletePendingRoomAlerts(visitorId) {
    console.log(warn(`Deleting ${visitorId} to pendingRoomAlerts Map`));
    this.pendingRoomAlerts.delete(visitorId);
    console.log(warn([...this.pendingRoomAlerts]));
    console.log(' ');
  }
}

module.exports = {
  getNow,
  logResults,
  printJson,
  ServerProxy,
};
