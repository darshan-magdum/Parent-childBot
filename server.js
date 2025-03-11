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
.then(() => console.log("✅ Connected to MongoDB"))
.catch(err => console.error("❌ MongoDB connection error:", err));

// ✅ **Schema for Child Bots**
const botSchema = new mongoose.Schema({
    botId: String,
    botName: String,
    capabilities: [String],
    directLineSecret: String,
    token: String,
    tokenExpiry: Date
});
const Bot = mongoose.model("Bot", botSchema);

// ✅ **Schema for Conversations (Tracking Messages)**
const conversationSchema = new mongoose.Schema({
    conversationId: String,
    botId: String,
    sender: String,  // "parent" or "child"
    message: String,
    timestamp: { type: Date, default: Date.now }
});
const Conversation = mongoose.model("Conversation", conversationSchema);

// ✅ **Common API for Sending and Receiving Messages**
app.post("/bot-communication", async (req, res) => {
    try {
        const { botId, message, sender } = req.body;

        if (sender === "parent") {
            // ✅ Parent sends a message to the child bot
            const bot = await Bot.findOne({ botId });
            if (!bot) return res.status(404).json({ error: "❌ Bot not found" });

            const directLineToken = await getValidToken(bot);

            const conversationResponse = await axios.post(
                "https://directline.botframework.com/v3/directline/conversations",
                {},
                { headers: { Authorization: `Bearer ${directLineToken}` } }
            );

            const conversationId = conversationResponse.data.conversationId;

            // ✅ Send message to child bot
            await axios.post(
                `https://directline.botframework.com/v3/directline/conversations/${conversationId}/activities`,
                {
                    type: "message",
                    from: { id: "parentBot" },
                    text: message
                },
                { headers: { Authorization: `Bearer ${directLineToken}` } }
            );

            // ✅ Store message in database
            await Conversation.create({
                conversationId,
                botId,
                sender: "parent",
                message
            });

            res.json({ message: "✅ Message sent successfully!", conversationId });

        } else if (sender === "child") {
            // ✅ Child bot response handling
            const lastParentMessage = await Conversation.findOne({ botId, sender: "parent" }).sort({ timestamp: -1 });

            if (!lastParentMessage) {
                console.log(`🚨 Message from ${botId} received, but no parent message found.`);
                return res.status(400).json({ error: "No matching parent message found." });
            }

            console.log(`📩 Received from ${botId}: ${message}`);

            // ✅ Store child bot's response
            await Conversation.create({
                conversationId: lastParentMessage.conversationId,
                botId,
                sender: "child",
                message
            });

            res.json({ status: "✅ Message received successfully!" });
        } else {
            res.status(400).json({ error: "❌ Invalid sender type. Use 'parent' or 'child'." });
        }
    } catch (error) {
        res.status(500).json({ error: "❌ Error in bot communication", details: error.message });
    }
});

// ✅ **Get Token (Refresh if Expired)**
async function getValidToken(bot) {
    const now = new Date();
    if (bot.token && bot.tokenExpiry > now) {
        return bot.token;
    }
    console.log(`🔄 Generating new token for ${bot.botName}`);
    const response = await axios.post(
        "https://directline.botframework.com/v3/directline/tokens/generate",
        {},
        { headers: { Authorization: `Bearer ${bot.directLineSecret}` } }
    );
    bot.token = response.data.token;
    bot.tokenExpiry = new Date(now.getTime() + 25 * 60 * 1000);
    await bot.save();
    return bot.token;
}

// ✅ **Add a New Child Bot**
app.post("/add-bot", async (req, res) => {
    try {
        const { botId, botName, capabilities, directLineSecret } = req.body;
        const newBot = new Bot({ botId, botName, capabilities, directLineSecret });
        await newBot.save();
        res.json({ message: "✅ Child bot added successfully!", bot: newBot });
    } catch (error) {
        res.status(500).json({ error: "❌ Error adding bot", details: error.message });
    }
});

// ✅ **Get Latest Parent Message for a Child Bot**
app.get("/messages/latest/:botId", async (req, res) => {
    try {
        const { botId } = req.params;
        const latestMessage = await Conversation.findOne({ botId, sender: "parent" }).sort({ timestamp: -1 });

        if (!latestMessage) {
            return res.json({ message: "❌ No messages found from parent bot to this child bot." });
        }

        res.json({ latestMessage });
    } catch (error) {
        res.status(500).json({ error: "❌ Error fetching latest message", details: error.message });
    }
});

// ✅ **Start Server**
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
