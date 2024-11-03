const express = require("express");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const stripe = require("stripe")(process.env.STRIPE);
const cors = require("cors");
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.USER}:${process.env.PASS}@cluster0.jxau4.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

//verifying JWT
function verifyJWT(req, res, next) {
  console.log("abc");
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "UnAuthorized access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    client.connect();
    const partCollection = client.db("istockSources").collection("parts");
    const userCollection = client.db("istockSources").collection("users");
    const orderCollection = client.db("istockSources").collection("orders");
    const reviewCollection = client.db("istockSources").collection("reviews");
    const paymentCollection = client.db("istockSources").collection("payments");

    //verify admin
    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAcct = await userCollection.findOne({ email: requester });
      if (requesterAcct.role === "admin") {
        next();
      } else {
        res.status(403).send({ message: "Forbidden" });
      }
    };

    app.get("/user", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    //get user information
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN, {
        expiresIn: "20h",
      });
      res.send({ result, token });
    });

    //get admins
    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });

    //make admin
    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: { role: "admin" },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //update userprofile
    app.put("/user/user/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //remove user
    app.delete(
      "/user/admin/:email",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const filter = { email: email };
        const result = await userCollection.deleteOne(filter);
        res.send(result);
      }
    );

    //get all parts
    app.get("/part", async (req, res) => {
      const query = {};
      const cursor = partCollection.find(query);
      const parts = await cursor.toArray();
      res.send(parts);
    });

    //get single part by parts id
    app.get("/order/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const part = await partCollection.findOne(query);
      res.send(part);
    });

    //post new order
    app.post("/order", async (req, res) => {
      const order = req.body;
      const query = { name: order.name, date: order.date, user: order.user };
      const exists = await orderCollection.findOne(query);
      if (exists) {
        return res.send({ success: false, order: exists });
      }
      const result = await orderCollection.insertOne(order);
      res.send({ success: true, result });
    });

    //get order by user verification
    app.get("/order", verifyJWT, async (req, res) => {
      const user = req.query.user;
      const decodedEmail = req.decoded.email;
      if (user === decodedEmail) {
        const query = { user: user };
        const orders = await orderCollection.find(query).toArray();
        return res.send(orders);
      } else {
        return res.status(403).send({ message: "Forbidded access" });
      }
    });

    //get order for payment
    app.get("/orders/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const order = await orderCollection.findOne(query);
      res.send(order);
    });
    //payment
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const part = req.body;
      const price = part.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    //update payment
    app.patch("/order/:id", async (req, res) => {
      const id = req.params.id;
      const payment = req.body;
      const filter = { _id: ObjectId(id) };
      const updatedDoc = {
        $set: {
          paid: true,
          trxId: payment.trxId,
        },
      };
      const updatedOrder = await orderCollection.updateOne(filter, updatedDoc);
      const result = await paymentCollection.insertOne(payment);
      res.send(updatedDoc);
    });
    //cancel order
    app.delete("/order/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await orderCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/order/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const order = await orderCollection.findOne(query);
      res.send(order);
    });

    //get all review
    app.get("/review", async (req, res) => {
      const query = {};
      const cursor = reviewCollection.find(query);
      const reviews = await cursor.toArray();
      res.send(reviews);
    });

    //post a review
    app.post("/review", verifyJWT, async (req, res) => {
      const review = req.body;
      const result = await reviewCollection.insertOne(review);
      res.send(result);
    });

    //get all orders
    app.get("/orders", async (req, res) => {
      const query = {};
      const cursor = orderCollection.find(query);
      const orders = await cursor.toArray();
      res.send(orders);
    });

    //post a part
    app.post("/part", verifyJWT, verifyAdmin, async (req, res) => {
      const part = req.body;
      const result = await partCollection.insertOne(part);
      res.send(result);
    });

    //delete part
    app.delete("/part/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await partCollection.deleteOne(query);
      res.send(result);
    });

    //send message
    app.post("/sentmessage", async (req, res) => {
      const data = req.body;
      try {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.APP_EMAIL,
            pass: process.env.APP_PASSWORD,
          },
        });

        await transporter.sendMail({
          from: {
            name: "Istock Sources",
            address: process.env.APP_EMAIL,
          },
          to: "sebok.das66@gmail.com",
          subject: data.subject,
          text: data.text,
        });

        res.json({ message: "Message Sent", status: 200 });
      } catch (error) {
        res.json({
          message: "Error sending email",
          error: error.message,
          status: 400,
        });
      }
    });
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello istock World!");
});

app.listen(port, () => {
  console.log(`istock app listening on port ${port}`);
});

// "build": "node index.js "
