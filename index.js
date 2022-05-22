const express = require('express');
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const cors = require('cors');
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.USER}:${process.env.PASS}@cluster0.jxau4.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
    try {
        await client.connect();
        const taskCollection = client.db('istockSources').collection('parts');

        app.get('/part', async (req, res) => {
            const query = {};
            const cursor = taskCollection.find(query).project({ name: 1 });
            const parts = await cursor.toArray();
            res.send(parts);
        });

    }
    finally { }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello istock World!');
});

app.listen(port, () => {
    console.log(`istock app listening on port ${port}`);
});