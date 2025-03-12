const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config();

const app = express();
const port = 3000;

// Middleware to parse JSON body
app.use(bodyParser.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));

// Bot Schema & Model
const botSchema = new mongoose.Schema({
    botName: { type: String, required: true },
    botId: { type: String, required: true, unique: true },
    capabilities: { type: [String], required: true },
    secretKey: { type: String, required: true }
});

const Bot = mongoose.model('Bot', botSchema);

// Register Bot (POST)
app.post('/api/bots/register', async (req, res) => {
    try {
        const { botName, botId, capabilities, secretKey } = req.body;
        if (!botName || !botId || !capabilities || !secretKey) {
            return res.status(400).json({ message: "All fields are required" });
        }
        const newBot = new Bot({ botName, botId, capabilities, secretKey });
        await newBot.save();
        res.status(201).json({ message: "Bot registered successfully", bot: newBot });
    } catch (error) {
        res.status(500).json({ message: "Server Error", error });
    }
});

// Get All Bots (GET)
app.get('/api/bots', async (req, res) => {
    try {
        const bots = await Bot.find(); // No exclusion of secretKey
        res.json(bots);
    } catch (error) {
        res.status(500).json({ message: "Server Error", error });
    }
});


// Function to continuously poll the bot API until a response is received
const getBotResponse = async (endpoint, conversationId, userId, key) => {
    while (true) {  // Infinite loop until bot responds
        try {
            const botResponseEndpoint = `${endpoint}/${conversationId}/activities`;
            const response = await axios.get(botResponseEndpoint, {
                headers: { 'Authorization': `Bearer ${key}` }
            });

            const activities = response.data.activities;
            const botMessages = activities.filter(activity => activity.from.id !== userId);

            if (botMessages.length > 0) {
                return botMessages[botMessages.length - 1].text; // Return as soon as bot responds
            }

        } catch (error) {
            console.error('Error fetching bot response:', error.response?.data || error.message);
            // Continue polling in case of an error
        }
    }
};

// POST API Endpoint
app.post('/api/post', async (req, res) => {
    const { Endpoint, Key, Message, UserId } = req.body;

    if (!Endpoint || !Key || !Message || !UserId) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    try {
        // Step 1: Start Conversation
        const conversationResponse = await axios.post(Endpoint, {}, {
            headers: {
                'Authorization': `Bearer ${Key}`,
                'Content-Type': 'application/json'
            }
        });

        const conversationId = conversationResponse.data.conversationId;
        console.log('Generated Conversation ID:', conversationId);

        // Step 2: Send a Message to the Bot
        const messageEndpoint = `${Endpoint}/${conversationId}/activities`;
        await axios.post(messageEndpoint, {
            type: 'message',
            from: { id: UserId },
            text: Message
        }, {
            headers: {
                'Authorization': `Bearer ${Key}`,
                'Content-Type': 'application/json'
            }
        });

        // Step 3: Keep polling for the bot response until received
        const botReply = await getBotResponse(Endpoint, conversationId, UserId, Key);

        // Step 4: Send response
        res.status(200).json({
            message: 'Conversation started and message sent successfully',
            conversationId: conversationId,
            botResponse: botReply
        });

    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to communicate with bot', details: error.response?.data || error.message });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
