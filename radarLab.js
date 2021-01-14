let pendingWarnings = new Map();
let pendingAlerts = new Map();

warn = (id, warning) => {
  pendingWarnings.set(id, warning);
};

warn('TVHqWfs6Qmuxjrd5AAAA', {
  visitor: 'Corning',
  id: 'TVHqWfs6Qmuxjrd5AAAA',
  nsp: '/',
});
console.log(JSON.stringify([...pendingWarnings], null, 3));

warn('mHmFaePdy7mYYnV-AAAA', {
  visitor: 'Tao',
  id: 'mHmFaePdy7mYYnV-AAAA',
  nsp: '/',
});

console.log(JSON.stringify([...pendingWarnings], null, 3));
console.log(' ');
console.log(
  JSON.stringify(pendingWarnings.get('TVHqWfs6Qmuxjrd5AAAA'), null, 3)
);

console.log();
