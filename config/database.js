const { CosmosClient } = require('@azure/cosmos');

// Cosmos DB setup - singleton client
const client = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY
});

// Testing database and container
const database = client.database(process.env.COSMOS_DATABASE);
const container = database.container(process.env.COSMOS_CONTAINER);

// KWatch database and container (Final database)
const kwatchDatabase = client.database(process.env.COSMOS_KWATCH_DATABASE);
const kwatchContainer = kwatchDatabase.container(process.env.COSMOS_KWATCH_CONTAINER); // Container for KWatch Raw Data
const kwatchProcessedContainer = kwatchDatabase.container(process.env.COSMOS_KWATCH_PROCESSED_CONTAINER); // Container for Processed KWatch Data

module.exports = {
  client,
  database,
  container,
  kwatchDatabase,
  kwatchContainer,
  kwatchProcessedContainer
};
