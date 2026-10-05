/*
 * Bird customisation catalogue: body colours and hats. `unlock` is the best
 * score needed to equip an item (0 = available from the start). All pixel
 * art is original; hat maps are positioned relative to the top-left of the
 * 17 × 12 bird body (negative oy = above the head).
 */
(function (ns) {
  'use strict';

  var colors = [
    { id: 'sunny', name: 'SUNNY', unlock: 0,
      palette: { o: '#ff8c2e', h: '#ffc06b', d: '#e0621c', c: '#ffd28f', b: '#ffd93b', r: '#f2a516', m: '#ffffff', n: '#ead7b6' } },
    { id: 'sky', name: 'SKY', unlock: 0,
      palette: { o: '#45a2f5', h: '#9fd4ff', d: '#2a6fc9', c: '#d4ecff', b: '#ffd93b', r: '#f2a516', m: '#ffffff', n: '#c9dcef' } },
    { id: 'berry', name: 'BERRY', unlock: 0,
      palette: { o: '#ff5f9e', h: '#ffa8cb', d: '#d23a75', c: '#ffd6e6', b: '#ffd93b', r: '#f2a516', m: '#ffffff', n: '#f0c9d8' } },
    { id: 'mint', name: 'MINT', unlock: 0,
      palette: { o: '#3fc77c', h: '#97ecbb', d: '#23935a', c: '#d9f7e5', b: '#ff9a3c', r: '#d9701e', m: '#ffffff', n: '#cbe8d6' } },
    { id: 'plum', name: 'PLUM', unlock: 0,
      palette: { o: '#9466ff', h: '#c7adff', d: '#6439d1', c: '#e8ddff', b: '#ffd93b', r: '#f2a516', m: '#ffffff', n: '#d6cbef' } },
    { id: 'snow', name: 'SNOW', unlock: 10,
      palette: { o: '#eef1f5', h: '#ffffff', d: '#bcc5d2', c: '#ffffff', b: '#ff9a3c', r: '#d9701e', m: '#d7dee8', n: '#aeb8c6' } },
    { id: 'gold', name: 'GOLD', unlock: 25,
      palette: { o: '#ffc928', h: '#fff09a', d: '#d39a0c', c: '#fff4c4', b: '#ff7a2e', r: '#d1531a', m: '#fffbe8', n: '#f0d27a' } }
  ];

  var hats = [
    { id: 'none', name: 'NONE', unlock: 0, art: null },
    { id: 'cap', name: 'CAP', unlock: 0, art: {
      ox: 3, oy: -3,
      palette: { k: '#2b1d14', R: '#e8403a', W: '#ff9a8c', S: '#a8241f' },
      rows: [
        '...kkkkk.....',
        '..kWRRRRk....',
        '.kRRRRRRRkkk.',
        '.kSSSSSSSSSSk'
      ] } },
    { id: 'bow', name: 'BOW', unlock: 0, art: {
      ox: 3, oy: -4,
      palette: { k: '#2b1d14', P: '#ff4f93', L: '#ffa3c8' },
      rows: [
        '.kk...kk.',
        'kLLk.kLLk',
        'kPPPkPPPk',
        'kPPkkkPPk',
        '.kk...kk.'
      ] } },
    { id: 'shades', name: 'SHADES', unlock: 5, art: {
      ox: 3, oy: 2,
      palette: { k: '#14101a', G: '#262238', H: '#7f9be0', W: '#ffffff' },
      rows: [
        'kkkkkkkkkkkkk',
        '.......kGGWHk',
        '.......kGGGGk',
        '........kkkk.'
      ] } },
    { id: 'party', name: 'PARTY', unlock: 10, art: {
      ox: 5, oy: -6,
      palette: { k: '#2b1d14', Y: '#ffd23f', P: '#3fa7ff', W: '#ffffff' },
      rows: [
        '..W..',
        '.kYk.',
        '.kPk.',
        'kYYYk',
        'kPPPk',
        'kkkkk'
      ] } },
    { id: 'crown', name: 'CROWN', unlock: 20, art: {
      ox: 4, oy: -5,
      palette: { k: '#2b1d14', Y: '#ffd23f', O: '#c98a12', R: '#e83b3b', W: '#fff6b8' },
      rows: [
        'k.k.k.k',
        'kWkYkYk',
        'kYYYYYk',
        'kYRYRYk',
        'kOOOOOk'
      ] } }
  ];

  function indexOf(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return 0;
  }

  ns.Skins = { colors: colors, hats: hats, indexOf: indexOf, HEAD_ROOM: 6 };
})(globalThis.Flapling = globalThis.Flapling || {});
