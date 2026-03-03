const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const http = require('http');
const socketIo = require('socket.io');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Firebase with environment variables
const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL
};

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    // Realtime Database URL - ADD YOUR URL HERE
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com/`
});

// Initialize Firestore
const firestore = admin.firestore();
firestore.settings({ ignoreUndefinedProperties: true });

// Initialize Realtime Database
const rtdb = admin.database();

const app = express();
const server = http.createServer(app);

// Socket.IO for WebRTC signaling
const io = socketIo(server, {
    cors: {
        origin: ['http://localhost:5500', 'http://127.0.0.1:5500'],
        credentials: true
    }
});

app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500'],
    credentials: true
}));
app.use(express.json());

// Track active streams
const activeStreams = new Map(); // streamId -> { host: socketId, viewers: Set }

io.on('connection', (socket) => {
    console.log('🟢 Client connected:', socket.id);

    // Host starts stream
    socket.on('host-start', async (data) => {
        const { streamId, title, description, userName } = data;

        console.log('📡 Host starting stream:', streamId);
        console.log('👤 Host name:', userName);

        // ✅ Ensure userName has a default value
        const safeUserName = userName || 'Anonymous Host';

        // SAVE TO BOTH DATABASES:

        // 1. Save to Firestore
        await firestore.collection('streams').doc(streamId).set({
            title: title || 'Untitled Stream',
            description: description || '',
            streamerName: safeUserName,
            status: 'live',
            viewerCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 2. Save to Realtime Database
        await rtdb.ref(`streams/${streamId}`).set({
            title: title || 'Untitled Stream',
            description: description || '',
            streamerName: safeUserName,
            status: 'live',
            viewerCount: 0,
            createdAt: new Date().toISOString(),
            startedAt: admin.database.ServerValue.TIMESTAMP
        });

        // Track this stream
        activeStreams.set(streamId, {
            host: socket.id,
            viewers: new Set()
        });

        socket.join(`stream-${streamId}`);
        socket.emit('host-ready', { streamId });
    });

    // Viewer joins stream
    socket.on('viewer-join', (streamId) => {
        const stream = activeStreams.get(streamId);
        if (!stream) {
            socket.emit('error', 'Stream not found');
            return;
        }

        socket.join(`stream-${streamId}`);
        stream.viewers.add(socket.id);

        // Tell host about new viewer
        io.to(stream.host).emit('viewer-joined', {
            viewerId: socket.id,
            count: stream.viewers.size
        });

        // Update viewer count for all
        io.to(`stream-${streamId}`).emit('viewer-count', stream.viewers.size);

        // Update viewer count in BOTH databases
        const viewerCount = stream.viewers.size;

        // Update Firestore
        firestore.collection('streams').doc(streamId).update({
            viewerCount: viewerCount
        }).catch(err => console.log('Firestore update error:', err));

        // Update Realtime Database
        rtdb.ref(`streams/${streamId}/viewerCount`).set(viewerCount)
            .catch(err => console.log('RTDB update error:', err));

        console.log(`👤 Viewer joined, ${viewerCount} viewers`);
    });

    // WebRTC signaling
    socket.on('offer', (data) => {
        const { to, offer } = data;
        io.to(to).emit('offer', {
            offer,
            from: socket.id
        });
    });

    socket.on('answer', (data) => {
        const { to, answer } = data;
        io.to(to).emit('answer', {
            answer,
            from: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        const { to, candidate } = data;
        io.to(to).emit('ice-candidate', {
            candidate,
            from: socket.id
        });
    });

    // Chat
    socket.on('send-message', async (data) => {
        const { streamId, message, userName } = data;

        // SAVE TO BOTH DATABASES:

        // 1. Save to Firestore
        const chatRef = await firestore.collection('chats').add({
            streamId,
            message: message || '',
            userName: userName || 'Anonymous',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // 2. Save to Realtime Database
        const chatId = chatRef.id;
        await rtdb.ref(`chats/${streamId}/${chatId}`).set({
            message: message || '',
            userName: userName || 'Anonymous',
            timestamp: new Date().toISOString()
        });

        io.to(`stream-${streamId}`).emit('new-message', {
            userName: userName || 'Anonymous',
            message,
            timestamp: new Date().toISOString()
        });
    });

    // Host stops stream
    socket.on('host-stop', async (streamId) => {
        io.to(`stream-${streamId}`).emit('stream-ended');
        activeStreams.delete(streamId);

        // Update BOTH databases
        try {
            // Update Firestore
            await firestore.collection('streams').doc(streamId).update({
                status: 'ended',
                endedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Update Realtime Database
            await rtdb.ref(`streams/${streamId}`).update({
                status: 'ended',
                endedAt: new Date().toISOString()
            });
        } catch (err) {
            console.log('Error updating stream status:', err);
        }

        console.log('🔴 Stream ended:', streamId);
    });

    // Disconnect
    socket.on('disconnect', () => {
        for (const [streamId, stream] of activeStreams.entries()) {
            if (stream.host === socket.id) {
                io.to(`stream-${streamId}`).emit('stream-ended');
                activeStreams.delete(streamId);
                console.log('🔴 Host disconnected, stream ended:', streamId);
            } else if (stream.viewers.has(socket.id)) {
                stream.viewers.delete(socket.id);
                const viewerCount = stream.viewers.size;

                io.to(stream.host).emit('viewer-left', {
                    count: viewerCount
                });
                io.to(`stream-${streamId}`).emit('viewer-count', viewerCount);

                // Update viewer count in both databases
                firestore.collection('streams').doc(streamId).update({
                    viewerCount: viewerCount
                }).catch(err => console.log('Firestore update error:', err));

                rtdb.ref(`streams/${streamId}/viewerCount`).set(viewerCount)
                    .catch(err => console.log('RTDB update error:', err));
            }
        }
    });
});

// API Routes - FIRESTORE VERSION
app.get('/api/streams/firestore', async (req, res) => {
    try {
        const snapshot = await firestore.collection('streams')
            .where('status', '==', 'live')
            .get();

        const streams = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            streams.push({
                id: doc.id,
                title: data.title || 'Untitled',
                description: data.description || '',
                streamerName: data.streamerName || 'Anonymous',
                viewerCount: data.viewerCount || 0,
                createdAt: data.createdAt?.toDate() || new Date()
            });
        });

        res.json(streams);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API Routes - REALTIME DATABASE VERSION
app.get('/api/streams/realtime', async (req, res) => {
    try {
        const snapshot = await rtdb.ref('streams').once('value');
        const streamsData = snapshot.val() || {};

        const streams = Object.entries(streamsData)
            .filter(([_, data]) => data.status === 'live')
            .map(([id, data]) => ({
                id,
                title: data.title || 'Untitled',
                description: data.description || '',
                streamerName: data.streamerName || 'Anonymous',
                viewerCount: data.viewerCount || 0,
                createdAt: data.createdAt || new Date().toISOString()
            }));

        res.json(streams);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// COMBINED API - Get from both (Firestore primary, RTDB backup)
app.get('/api/streams', async (req, res) => {
    try {
        // Try Firestore first
        const snapshot = await firestore.collection('streams')
            .where('status', '==', 'live')
            .get();

        const streams = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            streams.push({
                id: doc.id,
                title: data.title || 'Untitled',
                description: data.description || '',
                streamerName: data.streamerName || 'Anonymous',
                viewerCount: data.viewerCount || 0,
                createdAt: data.createdAt?.toDate() || new Date(),
                source: 'firestore'
            });
        });

        res.json(streams);
    } catch (error) {
        console.log('Firestore failed, trying RTDB:', error.message);

        // Fallback to Realtime Database
        try {
            const snapshot = await rtdb.ref('streams').once('value');
            const streamsData = snapshot.val() || {};

            const streams = Object.entries(streamsData)
                .filter(([_, data]) => data.status === 'live')
                .map(([id, data]) => ({
                    id,
                    title: data.title || 'Untitled',
                    description: data.description || '',
                    streamerName: data.streamerName || 'Anonymous',
                    viewerCount: data.viewerCount || 0,
                    createdAt: data.createdAt || new Date().toISOString(),
                    source: 'realtime'
                }));

            res.json(streams);
        } catch (rtdbError) {
            console.error('Both databases failed:', rtdbError);
            res.status(500).json({ error: 'Failed to fetch streams from any database' });
        }
    }
});

// Get single stream from both databases
app.get('/api/streams/:id', async (req, res) => {
    try {
        // Try Firestore first
        const doc = await firestore.collection('streams').doc(req.params.id).get();

        if (doc.exists) {
            const data = doc.data();
            return res.json({
                id: doc.id,
                title: data.title || 'Untitled',
                description: data.description || '',
                streamerName: data.streamerName || 'Anonymous',
                viewerCount: data.viewerCount || 0,
                status: data.status || 'ended',
                source: 'firestore'
            });
        }

        // If not in Firestore, try Realtime Database
        const rtdbSnapshot = await rtdb.ref(`streams/${req.params.id}`).once('value');
        const rtdbData = rtdbSnapshot.val();

        if (rtdbData) {
            return res.json({
                id: req.params.id,
                title: rtdbData.title || 'Untitled',
                description: rtdbData.description || '',
                streamerName: rtdbData.streamerName || 'Anonymous',
                viewerCount: rtdbData.viewerCount || 0,
                status: rtdbData.status || 'ended',
                source: 'realtime'
            });
        }

        return res.status(404).json({ error: 'Stream not found in any database' });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create stream (saves to both)
app.post('/api/create-stream', async (req, res) => {
    try {
        const { title, description, streamerName, userId } = req.body;

        const streamId = Math.random().toString(36).substring(2, 15);

        const streamData = {
            title: title || 'Untitled Stream',
            description: description || '',
            streamerName: streamerName || 'Anonymous',
            streamerId: userId || 'anonymous',
            status: 'idle',
            viewerCount: 0,
            createdAt: new Date().toISOString()
        };

        // Save to Firestore
        await firestore.collection('streams').doc(streamId).set({
            ...streamData,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Save to Realtime Database
        await rtdb.ref(`streams/${streamId}`).set({
            ...streamData,
            createdAt: admin.database.ServerValue.TIMESTAMP
        });

        res.json({
            success: true,
            streamId,
            ...streamData,
            savedTo: ['firestore', 'realtime']
        });
    } catch (error) {
        console.error('Create stream error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get chat history from both databases
app.get('/api/chats/:streamId', async (req, res) => {
    try {
        const { streamId } = req.params;

        // Try Firestore first
        const snapshot = await firestore.collection('chats')
            .where('streamId', '==', streamId)
            .orderBy('timestamp', 'asc')
            .limit(50)
            .get();

        if (!snapshot.empty) {
            const chats = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                chats.push({
                    id: doc.id,
                    message: data.message,
                    userName: data.userName,
                    timestamp: data.timestamp?.toDate() || new Date()
                });
            });
            return res.json({ source: 'firestore', chats });
        }

        // Fallback to Realtime Database
        const rtdbSnapshot = await rtdb.ref(`chats/${streamId}`).once('value');
        const chatsData = rtdbSnapshot.val() || {};

        const chats = Object.entries(chatsData)
            .map(([id, data]) => ({
                id,
                message: data.message,
                userName: data.userName,
                timestamp: new Date(data.timestamp || Date.now())
            }))
            .sort((a, b) => a.timestamp - b.timestamp);

        res.json({ source: 'realtime', chats });

    } catch (error) {
        console.error('Error fetching chats:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📊 Firebase initialized with:`);
    console.log(`   - Firestore ✅`);
    console.log(`   - Realtime Database ✅`);
    console.log(`🌐 Open viewer: http://localhost:5500/viewer/`);
    console.log(`🎥 Open host: http://localhost:5500/host/\n`);
});