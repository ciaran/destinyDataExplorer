/* global zip */
import Dexie from "dexie";
import axios from "axios";
import { every } from "lodash";

import "imports-loader?wrapper=window!@destiny-item-manager/zip.js"; // eslint-disable-line
import inflate from "file-loader!@destiny-item-manager/zip.js/WebContent/inflate.js"; // eslint-disable-line
import zipWorker from "file-loader!@destiny-item-manager/zip.js/WebContent/z-worker.js"; // eslint-disable-line

import { requireDatabase, getAllRecords } from "./database";
import { getDestiny } from "lib/destiny";

const log = require("lib/log")("definitions");

const VERSION = "v1";

Dexie.delete("destinyManifest");

const db = new Dexie("destinyDefinitions");
db.version(1).stores({
  manifestBlob: "&key, data",
  allData: "&key, data",
});

db.version(2).stores({
  manifestBlob: "&key, data",
  allData: "&key, data",
  jsonTables: "&key, data",
});

export const STATUS_DOWNLOADING = "downloading";
export const STATUS_EXTRACTING_TABLES = "extracting tables";
export const STATUS_UNZIPPING = "unzipping";
export const STATUS_DONE = "done";

async function fetchManifestDBPath(language) {
  log("Requesting manifest for language", language);

  const data = await getDestiny("/Platform/Destiny2/Manifest/", {
    _noAuth: true,
  });
  log("Manifest returned from Bungie", data);
  return data.mobileWorldContentPaths[language];
}

function onDownloadProgress(progress) {
  const perc = Math.round((progress.loaded / progress.total) * 100);
  log(`Definitions archive download progress ${perc}% . `);
}

function requestDefinitionsArchive(dbPath) {
  log("Requesting fresh definitions archive", { dbPath });

  return db.manifestBlob.get(dbPath).then((cachedValue) => {
    if (cachedValue) {
      log("Archive was already cached, returning that");
      return cachedValue.data;
    }

    return axios(`https://www.bungie.net${dbPath}`, {
      responseType: "blob",
      onDownloadProgress,
    }).then((resp) => {
      log("Finished downloading definitions archive, storing it in db");
      db.manifestBlob.put({ key: dbPath, data: resp.data });
      return resp.data;
    });
  });
}

function unzipManifest(blob) {
  log("Unzipping definitions archive");

  return new Promise((resolve, reject) => {
    zip.useWebWorkers = true;
    zip.workerScripts = { inflater: [zipWorker, inflate] };

    zip.createReader(
      new zip.BlobReader(blob),
      (zipReader) => {
        // get all entries from the zip
        zipReader.getEntries((entries) => {
          if (!entries.length) {
            log("Zip archive is empty. Something went wrong");
            const err = new Error("Definitions archive is empty");
            return reject(err);
          }

          log("Found", entries.length, "entries within definitions archive");
          log("Loading first file...", entries[0].filename);

          entries[0].getData(new zip.BlobWriter(), (blob) => {
            resolve(blob);
          });
        });
      },
      (error) => {
        reject(error);
      }
    );
  });
}

function loadDefinitions(dbPath, progressCb) {
  return requestDefinitionsArchive(dbPath)
    .then((data) => {
      log("Successfully downloaded definitions archive");
      progressCb({ status: STATUS_UNZIPPING });
      return unzipManifest(data);
    })
    .then((manifestBlob) => {
      log("Successfully unzipped definitions archive");
      return manifestBlob;
    });
}

function openDBFromBlob(SQLLib, blob) {
  const url = window.URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = function (e) {
      const uInt8Array = new Uint8Array(this.response);
      resolve(new SQLLib.Database(uInt8Array));
    };
    xhr.send();
  });
}

let requireDatabasePromise;

async function allDataFromRemote(dbPath, tablesNames, progressCb, _language) {
  if (!requireDatabasePromise) {
    requireDatabasePromise = requireDatabase();
  }

  try {
    const [SQLLib, databaseBlob] = await Promise.all([
      requireDatabasePromise,
      loadDefinitions(dbPath, progressCb),
    ]);

    progressCb({ status: STATUS_EXTRACTING_TABLES });

    log("Loaded both SQL library and definitions database");
    const db = await openDBFromBlob(SQLLib, databaseBlob);
    log("Opened database as SQLite DB object");

    const tablesToRequest =
      tablesNames ||
      db
        .exec(`SELECT name FROM sqlite_master WHERE type='table';`)[0]
        .values.map((a) => a[0]);

    log("Extracting tables from definitions database", tablesToRequest);

    const allData = tablesToRequest.reduce((acc, tableName) => {
      log("Getting all records for", tableName);

      return {
        ...acc,
        [tableName]: getAllRecords(db, tableName),
      };
    }, {});

    const language = _language || "en";
    const manifest = await getDestiny("/Platform/Destiny2/Manifest/", {
      _noAuth: true,
    });

    const jsonComponents = Object.entries(
      manifest.jsonWorldComponentContentPaths[language]
    ).filter(
      ([tableName]) =>
        !allData[tableName] &&
        tableName !== "DestinyInventoryItemLiteDefinition"
    );

    for (const [tableName, tablePath] of jsonComponents) {
      const resp = await fetch(`https://www.bungie.net${tablePath}`);
      const table = await resp.json();
      allData[tableName] = table;
    }

    return allData;
  } catch (err) {
    // TODO: Fix memory issue with SQLLib or more gracefully handle failure
    // window.location.reload();

    // without throwing an error the data becomes corrupted
    throw err;
  }
}

function cleanUpPreviousVersions(dbPath, keyToKeep) {
  db.allData
    .toCollection()
    .primaryKeys()
    .then((keys) => {
      const toDelete = keys.filter((key) => !key.includes(keyToKeep));
      log("Deleting stale manifest data", toDelete);
      return db.allData.bulkDelete(toDelete);
    });

  db.manifestBlob
    .toCollection()
    .primaryKeys()
    .then((keys) => {
      const toDelete = keys.filter((key) => !key.includes(dbPath));
      log("Deleting stale manifest data", toDelete);
      return db.manifestBlob.bulkDelete(toDelete);
    });
}

function includesAllRequestedTables(data, requested) {
  const cachedTables = Object.keys(data);
  return every(requested, (n) => cachedTables.includes(n));
}

const noop = () => {};

export function fasterGetDefinitions(
  language,
  requestedTableNames,
  _progressCb,
  dataCb
) {
  const versionId = `${VERSION}:`;
  let earlyCache;

  const progressCb = _progressCb || noop;

  db.allData
    .toCollection()
    .toArray()
    .then((data) => {
      const found = data.find((d) => {
        return d.key.indexOf(versionId) === 0;
      });

      if (
        found &&
        includesAllRequestedTables(found.data, requestedTableNames)
      ) {
        log("Returning early cached definitions early");
        earlyCache = found;
        dataCb(null, { definitions: found.data });
      }

      log("Requesting current definitions database path");
      return fetchManifestDBPath(language).then((dbPath) => {
        if (earlyCache && earlyCache.key.includes(dbPath)) {
          log("The cached definitions are the latest. We are done here");
          return dataCb(null, { done: true });
        }

        progressCb({ status: STATUS_DOWNLOADING });

        allDataFromRemote(
          dbPath,
          requestedTableNames,
          progressCb,
          language
        ).then((definitions) => {
          log("Successfully got requested definitions");

          const key = [VERSION, dbPath].join(":");
          db.allData.put({ key, data: definitions });

          cleanUpPreviousVersions(dbPath, key);

          dataCb(null, { done: true, definitions });
        });
      });
    })
    .catch((err) => {
      log("Error loading definitions", err);
      dataCb(err);
    });
}
