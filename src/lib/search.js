import { memoize } from 'lodash';
import { makeAllDefsArray } from './destinyUtils';

const getComparableName = memoize(item => {
  const name = item && item.displayProperties && item.displayProperties.name;
  return name ? name.toLowerCase() : name;
});

const last = arr => arr[arr.length - 1];

const fallbackSearchFunction = {
  filterFn: (obj, searchTerm, comparableSearchTerm) => {
    const comparableName = getComparableName(obj.def);

    return (
      obj.key === searchTerm ||
      obj.type.toLowerCase().includes(comparableSearchTerm) ||
      (comparableName && comparableName.includes(comparableSearchTerm))
    );
  }
};

const SEARCH_FUNCTIONS = [
  {
    regex: /itemcategory:(\d+)/,
    parseInt: true,
    filterFn: (obj, categoryHash) => {
      return (
        obj.def &&
        obj.def.itemCategoryHashes &&
        obj.def.itemCategoryHashes.includes(categoryHash)
      );
    }
  }
];

export default function search(_searchTerm, definitions) {
  if (_searchTerm.length < 3) {
    return [];
  }

  const allDefs = makeAllDefsArray(definitions);
  const searchTerm = _searchTerm.toLowerCase();

  const results = tokenize(searchTerm).reduce((acc, query) => {
    let searchFn = SEARCH_FUNCTIONS.find(searchFn =>
      query.match(searchFn.regex)
    );

    console.log({ query, searchFn });

    let params = [];

    if (searchFn) {
      const match = query.match(searchFn.regex);
      const param = match[1];
      param && params.push(searchFn.parseInt ? parseInt(param, 10) : param);
    } else {
      const comparableQuery = query.toLowerCase();
      searchFn = fallbackSearchFunction;
      params = [query, comparableQuery];
    }

    return acc.filter(obj => searchFn.filterFn(obj, ...params));
  }, allDefs);

  return results;
}

function push(arr, thing) {
  arr.push(thing);
  return arr;
}

export function tokenize(searchTerm) {
  const phrases = searchTerm.split(' ').filter(s => s.length > 0);
  const collection = [];

  let running = true;
  let index = 0;

  while (running) {
    const word = phrases[index];

    if (!word) {
      running = false;
      break;
    }

    push(collection, word);

    if (word.includes(':')) {
      index += 1;
      continue; // return and run the next iteration
    }

    let innerIndex = index + 1;
    let innerRunning = true;

    while (innerRunning) {
      const innerWord = phrases[innerIndex];

      if (!innerWord) {
        innerRunning = false;
        break;
      }

      if (innerWord.includes(':')) {
        innerRunning = false;
        break;
      }

      const lastWord = last(collection);
      collection[collection.length - 1] = `${lastWord} ${innerWord}`;
      innerIndex += 1;
    }

    index = innerIndex;
  }

  return collection;
}
