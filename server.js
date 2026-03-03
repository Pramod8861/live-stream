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
    databaseURL: "https://live-stream-7b16a-default-rtdb.firebaseio.com" // Your Realtime DB URL
});

// Initialize both databases
const firestore = admin.firestore();
firestore.settings({ ignoreUndefinedProperties: true });

const realtimeDb = admin.database(); // Realtime Database

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
        const { streamId, title, description, userName, userId } = data;

        console.log('📡 Host starting stream:', streamId);
        console.log('👤 Host name:', userName);

        // ✅ Ensure values have defaults
        const safeUserName = userName || 'Anonymous Host';
        const safeUserId = userId || 'anonymous';

        try {
            // 1. Save to FIRESTORE
            await firestore.collection('streams').doc(streamId).set({
                title: title || 'Untitled Stream',
                description: description || '',
                streamerName: safeUserName,
                streamerId: safeUserId,
                status: 'live',
                viewerCount: 0,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                platform: 'web'
            });

            // 2. Save to REALTIME DATABASE
            const streamRef = realtimeDb.ref(`streams/${streamId}`);
            await streamRef.set({
                title: title || 'Untitled Stream',
                description: description || '',
                streamerName: safeUserName,
                streamerId: safeUserId,
                status: 'live',
                viewerCount: 0,
                createdAt: new Date().toISOString(),
                platform: 'web'
            });

            console.log('✅ Stream saved to both Firestore and Realtime DB');

            // Track this stream
            activeStreams.set(streamId, {
                host: socket.id,
                viewers: new Set()
            });

            socket.join(`stream-${streamId}`);
            socket.emit('host-ready', { streamId });

        } catch (error) {
            console.error('❌ Error saving stream:', error);
            socket.emit('error', 'Failed to start stream');
        }
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

        // Update viewer count in both databases
        const viewerCount = stream.viewers.size;

        // Update Firestore
        firestore.collection('streams').doc(streamId).update({
            viewerCount: viewerCount
        }).catch(err => console.log('Firestore update error:', err));

        // Update Realtime DB
        realtimeDb.ref(`streams/${streamId}/viewerCount`).set(viewerCount)
            .catch(err => console.log('Realtime DB update error:', err));

        // Tell host about new viewer
        io.to(stream.host).emit('viewer-joined', {
            viewerId: socket.id,
            count: viewerCount
        });

        // Update viewer count for all
        io.to(`stream-${streamId}`).emit('viewer-count', viewerCount);

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
        const { streamId, message, userName, userId } = data;

        try {
            const timestamp = new Date().toISOString();
            const messageId = Date.now().toString();

            // 1. Save to FIRESTORE
            await firestore.collection('chats').add({
                streamId,
                message: message || '',
                userName: userName || 'Anonymous',
                userId: userId || 'anonymous',
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            // 2. Save to REALTIME DATABASE
            const chatRef = realtimeDb.ref(`chats/${streamId}/${messageId}`);
            await chatRef.set({
                message: message || '',
                userName: userName || 'Anonymous',
                userId: userId || 'anonymous',
                timestamp: timestamp
            });

            // Broadcast to all in stream
            io.to(`stream-${streamId}`).emit('new-message', {
                userName: userName || 'Anonymous',
                message,
                timestamp: timestamp,
                messageId: messageId
            });

        } catch (error) {
            console.error('Chat error:', error);
        }
    });

    // Host stops stream
    socket.on('host-stop', (streamId) => {
        io.to(`stream-${streamId}`).emit('stream-ended');
        activeStreams.delete(streamId);

        // Update both databases
        firestore.collection('streams').doc(streamId).update({
            status: 'ended',
            endedAt: admin.firestore.FieldValue.serverTimestamp()
        }).catch(err => console.log('Firestore update error:', err));

        realtimeDb.ref(`streams/${streamId}/status`).set('ended')
            .catch(err => console.log('Realtime DB update error:', err));

        console.log('🔴 Stream ended:', streamId);
    });

    // Disconnect
    socket.on('disconnect', () => {
        for (const [streamId, stream] of activeStreams.entries()) {
            if (stream.host === socket.id) {
                io.to(`stream-${streamId}`).emit('stream-ended');
                activeStreams.delete(streamId);

                // Update both databases
                firestore.collection('streams').doc(streamId).update({
                    status: 'ended',
                    endedAt: admin.firestore.FieldValue.serverTimestamp()
                }).catch(err => console.log('Firestore update error:', err));

                realtimeDb.ref(`streams/${streamId}/status`).set('ended')
                    .catch(err => console.log('Realtime DB update error:', err));

                console.log('🔴 Host disconnected, stream ended:', streamId);

            } else if (stream.viewers.has(socket.id)) {
                stream.viewers.delete(socket.id);
                const viewerCount = stream.viewers.size;

                // Update viewer counts
                firestore.collection('streams').doc(streamId).update({
                    viewerCount: viewerCount
                }).catch(err => console.log('Firestore update error:', err));

                realtimeDb.ref(`streams/${streamId}/viewerCount`).set(viewerCount)
                    .catch(err => console.log('Realtime DB update error:', err));

                io.to(stream.host).emit('viewer-left', {
                    count: viewerCount
                });
                io.to(`stream-${streamId}`).emit('viewer-count', viewerCount);
            }
        }
    });
});

// API Routes
app.get('/api/streams', async (req, res) => {
    try {
        // Get from Firestore
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
                streamerId: data.streamerId || '',
                viewerCount: data.viewerCount || 0,
                createdAt: data.createdAt?.toDate() || new Date(),
                source: 'firestore'
            });
        });

        res.json(streams);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get stream from Realtime DB (alternative)
app.get('/api/rt-streams', async (req, res) => {
    try {
        const snapshot = await realtimeDb.ref('streams').once('value');
        const streams = snapshot.val() || {};

        const streamsList = Object.entries(streams).map(([id, data]) => ({
            id,
            ...data,
            source: 'realtime'
        })).filter(s => s.status === 'live');

        res.json(streamsList);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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
                streamerId: data.streamerId || '',
                viewerCount: data.viewerCount || 0,
                status: data.status || 'ended',
                source: 'firestore'
            });
        }

        // If not in Firestore, try Realtime DB
        const rtStream = await realtimeDb.ref(`streams/${req.params.id}`).once('value');

        if (rtStream.exists()) {
            const data = rtStream.val();
            return res.json({
                id: req.params.id,
                ...data,
                source: 'realtime'
            });
        }

        return res.status(404).json({ error: 'Stream not found' });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create stream
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
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            platform: 'web'
        };

        // Save to Firestore
        await firestore.collection('streams').doc(streamId).set(streamData);

        // Save to Realtime DB
        await realtimeDb.ref(`streams/${streamId}`).set({
            ...streamData,
            createdAt: new Date().toISOString()
        });

        res.json({
            success: true,
            streamId,
            ...streamData
        });
    } catch (error) {
        console.error('Create stream error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get chat history from Realtime DB
app.get('/api/chat/:streamId', async (req, res) => {
    try {
        const snapshot = await realtimeDb.ref(`chats/${req.params.streamId}`)
            .orderByKey()
            .limitToLast(50)
            .once('value');

        const chats = snapshot.val() || {};
        const chatList = Object.entries(chats).map(([id, data]) => ({
            id,
            ...data
        }));

        res.json(chatList);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📊 Firestore + Realtime Database both active`);
    console.log(`🌐 Open viewer: http://localhost:5500/viewer/`);
    console.log(`🎥 Open host: http://localhost:5500/host/\n`);
});