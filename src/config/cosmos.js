require('dotenv').config();
const { CosmosClient } = require('@azure/cosmos');

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE || 'community360_nosql';

const containerNames = {
  interacciones: process.env.COSMOS_CONTAINER_INTERACCIONES || 'interacciones',
  cuarentena: process.env.COSMOS_CONTAINER_CUARENTENA || 'cuarentena',
  bitacora: process.env.COSMOS_CONTAINER_BITACORA || 'bitacora_etl'
};

let client = null;

function getCosmosClient() {
  if (!client) {
    client = new CosmosClient({ endpoint, key });
  }
  return client;
}

function getCosmosDatabase() {
  return getCosmosClient().database(databaseId);
}

function getContainers() {
  const db = getCosmosDatabase();
  return {
    interacciones: db.container(containerNames.interacciones),
    cuarentena: db.container(containerNames.cuarentena),
    bitacora: db.container(containerNames.bitacora)
  };
}

async function ensureCosmosStructure() {
  const cosmosClient = getCosmosClient();
  const { database } = await cosmosClient.databases.createIfNotExists({ id: databaseId });

  await database.containers.createIfNotExists({
    id: containerNames.interacciones,
    partitionKey: { paths: ['/id_usuario'] }
  });

  await database.containers.createIfNotExists({
    id: containerNames.cuarentena,
    partitionKey: { paths: ['/origen'] }
  });

  await database.containers.createIfNotExists({
    id: containerNames.bitacora,
    partitionKey: { paths: ['/id'] }
  });

  return {
    databaseId,
    containers: containerNames
  };
}

module.exports = {
  databaseId,
  containerNames,
  getCosmosClient,
  getCosmosDatabase,
  getContainers,
  ensureCosmosStructure
};
