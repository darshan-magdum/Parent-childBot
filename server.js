const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(express.json());

// ✅ **Connect to MongoDB**
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("Connected to MongoDB"))
.catch(err => console.error("MongoDB connection error:", err));

// ✅ **Define Child Bot Schema**
const botSchema = new mongoose.Schema({
    botId: String,           // Unique Bot ID
    botName: String,         // Name of the Bot
    capabilities: [String],  // Array of capabilities
    directLineSecret: String, // Direct Line Secret
    token: String,           // Stores Direct Line token
    tokenExpiry: Date        // Expiry time of the token
});

const Bot = mongoose.model("Bot", botSchema);

// 1️⃣ **Add a New Child Bot**
app.post("/add-bot", async (req, res) => {
    try {
        const { botId, botName, capabilities, directLineSecret } = req.body;

        const newBot = new Bot({ botId, botName, capabilities, directLineSecret });
        await newBot.save();

        res.json({ message: "Child bot added successfully!", bot: newBot });
    } catch (error) {
        res.status(500).json({ error: "Error adding bot", details: error.message });
    }
});

// 2️⃣ **Find a Bot Based on Capability**
app.get("/find-bot/:capability", async (req, res) => {
    try {
        const { capability } = req.params;
        const bot = await Bot.findOne({ capabilities: capability });

        if (!bot) return res.status(404).json({ error: "No bot found for this capability" });

        res.json(bot);
    } catch (error) {
        res.status(500).json({ error: "Error finding bot", details: error.message });
    }
});

// 3️⃣ **Function to Generate or Refresh Token**
async function getValidToken(bot) {
    const now = new Date();

    if (bot.token && bot.tokenExpiry > now) {
        return bot.token; // ✅ Token is still valid
    }

    console.log("Generating new token for", bot.botName);

    // 🔄 Generate a new token
    const response = await axios.post(
        "https://directline.botframework.com/v3/directline/tokens/generate",
        {},
        { headers: { Authorization: `Bearer ${bot.directLineSecret}` } }
    );

    bot.token = response.data.token;
    bot.tokenExpiry = new Date(now.getTime() + 25 * 60 * 1000); // Set expiry in 25 minutes
    await bot.save();

    return bot.token;
}

// 4️⃣ **Send a Message to a Child Bot**
app.post("/send-message", async (req, res) => {
    try {
        const { botId, message } = req.body;
        const bot = await Bot.findOne({ botId });

        if (!bot) return res.status(404).json({ error: "Bot not found" });

        const directLineToken = await getValidToken(bot);

        // Start a new conversation
        const conversationResponse = await axios.post(
            "https://directline.botframework.com/v3/directline/conversations",
            {},
            { headers: { Authorization: `Bearer ${directLineToken}` } }
        );

        const conversationId = conversationResponse.data.conversationId;

        // Send the message to the bot
        await axios.post(
            `https://directline.botframework.com/v3/directline/conversations/${conversationId}/activities`,
            {
                type: "message",
                from: { id: "parentBot" },
                text: message
            },
            { headers: { Authorization: `Bearer ${directLineToken}` } }
        );

        res.json({ message: "Message sent successfully!", conversationId });
    } catch (error) {
        res.status(500).json({ error: "Error sending message", details: error.message });
    }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
