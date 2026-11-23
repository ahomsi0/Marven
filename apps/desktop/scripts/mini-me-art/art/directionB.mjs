// Direction B — "Chibi small" (32x32)
//
// Desktop-pet chibi: head ~half the height, 3x3 eyes with lash + highlight,
// blush, tiny mouth, stubby body. Smallest footprint on screen.
//
// Layer order (bottom -> top):  hair.back -> body -> beard -> hair.front -> glasses
// A hair entry is either a grid (front only) or { back, front }; bald = null.
//
// Animation notes: arms are 2-px columns (sleeve over skin) beside the torso,
// legs are two 3-px columns over 6-px shoes. Walk = 4 frames: on contact
// frames shift one leg+shoe block 1 px outward/forward and raise the other
// shoe 1 px; on passing frames bob everything above the hips down 1 px.
// Arms swing by moving the hand pixels 1 px forward/back. Sit = remove the
// leg block and draw a 2-row horizontal thigh run under the torso.
const _ = '................................';

const body = [
  _,
  _,
  _,
  '............oooooooo............',
  '..........ooSSSsssssoo..........',
  '.........oSSSssssssssto.........',
  '........oSSsssssssssssto........',
  '........oSskkksssskkksto........',
  '........oSssssssssssssto........',
  '........oSsooossssooosto........',
  '.......osSsLeEssssLeEssso.......',
  '.......otsseeEsssseeEstto.......',
  '.......osssEIEssssEIEssso.......',
  '........osKKssssssssKKto........',
  '........ossssssMMsssssto........',
  '.........osssssssssstto.........',
  '..........oossssssttoo..........',
  '.........oooooooooooooo.........',
  '.........oBbbbnttnbbbno.........',
  '........oBbnbbbbbbbbnbno........',
  '........oBbnBbbbbbbbnbno........',
  '........onnnbbbbbbbbnnno........',
  '........oStnbbbbbbbbnsto........',
  '........ostnnnnnnnnnnsto........',
  '.........oooPppppppqooo.........',
  '...........oPppqpppqo...........',
  '...........oPpqooppqo...........',
  '...........oPpqooppqo...........',
  '..........oFffvooFffvo..........',
  '..........offfvoofffvo..........',
  '..........oYYYyooYYYyo..........',
  '...........oooo..oooo...........',
];

const short = [
  _,
  '............kkkkkkkk............',
  '..........kkhHHHhhhhkk..........',
  '.........khHHHHhhhhhhjk.........',
  '........khhHHHhhhhhhhjjk........',
  '.......khhHHhjhhhhhjhjjjk.......',
  '.......khhhhjhhhhjhhhjjjk.......',
  '.......khjk....jk....kjhk.......',
  '.......khk............kjk.......',
  '.......kk..............kk.......',
  _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
];

const long = [
  _,
  '............kkkkkkkk............',
  '..........kkhHHHhhhhkk..........',
  '.........khHHHHhhhhhhjk.........',
  '........khhHHHhhhhhhhjjk........',
  '.......khhHHhjhhhhhjhjjjk.......',
  '......khhhhhjhhhhjhhhjjjjk......',
  '......khhjk....jk....kjjhk......',
  '......kHhk............kjjk......',
  '......khHk............kjhk......',
  '......kHhk............kjjk......',
  '......khhk............kjjk......',
  '......kHhk............khjk......',
  '......khhk............kjjk......',
  '......khjk............kjjk......',
  '......kHhk............kjhk......',
  '......khhk............kjjk......',
  '......khhk............kjjk......',
  '......khjk............kjjk......',
  '......khjk............kjjk......',
  '.......kjk............kjk.......',
  '........k..............k........',
  _, _, _, _, _, _, _, _, _, _,
];

const curly = [
  '...........kk.kkkk.kk...........',
  '.........kkhjkhhjhkhjkk.........',
  '.......kkhhHhhhHhhhHhhjkk.......',
  '......khhhjhhhjhhhjhhjhjjk......',
  '.....khhhHhhhHhhhHhjjhjjjhk.....',
  '.....khhjhhhjhhhjhjjhjjjjjk.....',
  '.....khHhhhkkkhHhjkkkjjhjjk.....',
  '.....kjhhhk...kjjk...kjjjjk.....',
  '.....khhhk.....kk.....kjjhk.....',
  '.....khhk..............kjjk.....',
  '.....khHk..............kjjk.....',
  '......khk..............kjk......',
  '.......k................k.......',
  _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
];

const buzz = [
  _, _, _,
  '............kkkkkkkk............',
  '..........kkhHHhhhhjkk..........',
  '.........khHhhjhhhhjhjk.........',
  '........khhjhjhjhjhjhjjk........',
  '.........j............j.........',
  '.........j............j.........',
  _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
];

const ponytailBack = [
  _, _, _,
  '.....................kkkk.......',
  '....................khhjjk......',
  '.....................khhjjk.....',
  '......................khhjjk....',
  '......................khhjjk....',
  '......................khjjjk....',
  '.......................khjjk....',
  '.......................khjjk....',
  '.......................kjjk.....',
  '......................kjjk......',
  '......................kjk.......',
  '.......................k........',
  _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
];

const glasses = [
  _, _, _, _, _, _, _, _, _,
  '...........GGG....GGG...........',
  '.........GGgggGGGGgggGG.........',
  '..........GgggG..GgggG..........',
  '..........GgglG..GgglG..........',
  '...........GGG....GGG...........',
  _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
];

const beard = [
  _, _, _, _, _, _, _, _, _, _, _, _,
  '........kj............jk........',
  '........khj..jhhhhj..jhk........',
  '........khhj........jhhk........',
  '.........khhjhhjjhhjhjk.........',
  '..........kjhHhhhhhjjk..........',
  '...........kkjjjjjjkk...........',
  _, _, _, _, _, _, _, _, _, _, _, _, _, _,
];

export default {
  name: 'B — Chibi small',
  layerOrder: ['hair.back', 'body', 'beard', 'hair.front', 'glasses'],
  size: 32,
  layers: {
    body,
    hair: { short, long, curly, buzz, bald: null, ponytail: { back: ponytailBack, front: short } },
    glasses,
    beard,
  },
  slots: 'B E F G H I K L M P S Y b e f g h j k l n o p q s t v y'.split(' '),
};
