// Comments are named after the sound your pet makes: dogs Bark, horses Neigh, cats Meow...
const SOUNDS = [
  { match: /dog|pupp/, word: 'Bark', words: 'Barks', past: 'barked' },
  { match: /cat|kitten/, word: 'Meow', words: 'Meows', past: 'meowed' },
  { match: /horse|pony|donkey/, word: 'Neigh', words: 'Neighs', past: 'neighed' },
  { match: /guinea/, word: 'Wheek', words: 'Wheeks', past: 'wheeked' },
  { match: /duck/, word: 'Quack', words: 'Quacks', past: 'quacked' },
  { match: /chicken|hen|rooster/, word: 'Cluck', words: 'Clucks', past: 'clucked' },
  { match: /bird|parrot|budgie|parakeet|canary/, word: 'Tweet', words: 'Tweets', past: 'tweeted' },
  { match: /cow|cattle/, word: 'Moo', words: 'Moos', past: 'mooed' },
  { match: /pig/, word: 'Oink', words: 'Oinks', past: 'oinked' },
  { match: /sheep|lamb/, word: 'Baa', words: 'Baas', past: 'baaed' },
  { match: /goat/, word: 'Bleat', words: 'Bleats', past: 'bleated' },
  { match: /rabbit|bunny/, word: 'Thump', words: 'Thumps', past: 'thumped' },
  { match: /hamster|mouse|rat|gerbil|ferret/, word: 'Squeak', words: 'Squeaks', past: 'squeaked' },
  { match: /fish/, word: 'Blub', words: 'Blubs', past: 'blubbed' },
  { match: /snake|reptile|lizard|turtle|tortoise|gecko/, word: 'Hiss', words: 'Hisses', past: 'hissed' },
  { match: /frog|toad/, word: 'Ribbit', words: 'Ribbits', past: 'ribbited' },
  // "Other" pets get plain words, since we don't know what sound they make.
  { match: /^other$/, word: 'Comment', words: 'Comments', past: 'commented', prompt: 'Write a comment...', sticker: 'Hello' },
];
const DEFAULT = { word: 'Bark', words: 'Barks', past: 'barked' };

export const PET_TYPES = ['Dog', 'Cat', 'Horse', 'Bird', 'Rabbit', 'Hamster', 'Guinea pig', 'Fish', 'Reptile', 'Cow', 'Pig', 'Sheep', 'Goat', 'Duck', 'Chicken', 'Frog', 'Other'];

export function soundFor(petType) {
  const t = String(petType || '').trim().toLowerCase();
  const s = SOUNDS.find(s => s.match.test(t)) || DEFAULT;
  return { prompt: `${s.word} back...`, sticker: s.word, ...s };
}

export const countLabel = (n, petType) => (n === 1 ? soundFor(petType).word : soundFor(petType).words);
