// Check if Firebase is already initialized
if (typeof firebase === 'undefined') {
    console.error('❌ Firebase SDK not loaded!');
} else {
    console.log('✅ Firebase SDK loaded');
}

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBEY1V9m8UIkgWUKJIbdhUuQKCo2I4rztM",
    authDomain: "live-stream-7b16a.firebaseapp.com",
    databaseURL: "https://live-stream-7b16a-default-rtdb.firebaseio.com",
    projectId: "live-stream-7b16a",
    storageBucket: "live-stream-7b16a.firebasestorage.app",
    messagingSenderId: "13367877746",
    appId: "1:13367877746:web:7950e063fee3c01109a2eb"
};

// Initialize Firebase ONLY if not already initialized
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
    console.log('✅ Firebase initialized for Netlify');
} else {
    console.log('✅ Firebase already initialized');
}

// Get Firebase services
const auth = firebase.auth();
const firestore = firebase.firestore();
const realtimeDb = firebase.database();

// Set persistence for Netlify
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(() => console.log('✅ Auth persistence set to LOCAL'))
    .catch((error) => console.error('Auth persistence error:', error));

// Enable Firestore persistence
firestore.enablePersistence({ synchronizeTabs: true })
    .then(() => console.log('✅ Firestore persistence enabled'))
    .catch((err) => {
        if (err.code == 'failed-precondition') {
            console.log('ℹ️ Multiple tabs open - persistence works in one tab');
        } else if (err.code == 'unimplemented') {
            console.log('ℹ️ Browser does not support persistence');
        }
    });

// Auth state observer
auth.onAuthStateChanged((user) => {
    console.log('Auth state changed:', user ? `✅ ${user.email}` : '👤 No user');

    // Redirect if on auth pages and logged in
    if (user) {
        const path = window.location.pathname;
        if (path.includes('login.html') || path.includes('signup.html')) {
            console.log('➡️ Redirecting to host dashboard...');
            window.location.href = '../host/index.html';
        }
    }
});

// LOGIN PAGE
if (window.location.pathname.includes('login.html')) {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const btn = document.getElementById('loginBtn');
            const btnText = document.getElementById('btnText');
            const spinner = document.getElementById('loadingSpinner');
            const errorDiv = document.getElementById('errorMessage');

            btn.disabled = true;
            btnText.style.display = 'none';
            spinner.style.display = 'inline-block';
            errorDiv.style.display = 'none';

            try {
                console.log('📡 Logging in:', email);

                const userCredential = await auth.signInWithEmailAndPassword(email, password);
                const user = userCredential.user;

                console.log('✅ User logged in:', user.email);

                // Update Firestore
                try {
                    await firestore.collection('users').doc(user.uid).update({
                        lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
                        loginCount: firebase.firestore.FieldValue.increment(1)
                    });
                } catch (err) {
                    console.log('Firestore update error:', err);
                }

                // Update Realtime DB
                try {
                    await realtimeDb.ref(`users/${user.uid}/lastLogin`).set({
                        timestamp: new Date().toISOString(),
                        device: navigator.userAgent
                    });
                } catch (err) {
                    console.log('Realtime DB error:', err);
                }

                window.location.href = '../host/index.html';

            } catch (error) {
                console.error('❌ Login error:', error);

                errorDiv.textContent = error.message;
                errorDiv.style.display = 'block';

                btn.disabled = false;
                btnText.style.display = 'inline';
                spinner.style.display = 'none';
            }
        });
    }
}

// SIGNUP PAGE
if (window.location.pathname.includes('signup.html')) {
    const passwordInput = document.getElementById('password');
    const strengthBar = document.getElementById('strengthBar');
    const strengthText = document.getElementById('strengthText');

    if (passwordInput) {
        passwordInput.addEventListener('input', () => {
            const password = passwordInput.value;
            let strength = 0;

            if (password.length >= 8) strength++;
            if (password.match(/[a-z]/)) strength++;
            if (password.match(/[A-Z]/)) strength++;
            if (password.match(/[0-9]/)) strength++;
            if (password.match(/[^a-zA-Z0-9]/)) strength++;

            strengthBar.className = 'strength-bar';
            if (strength <= 2) {
                strengthBar.classList.add('weak');
                strengthText.textContent = 'Weak password';
            } else if (strength <= 4) {
                strengthBar.classList.add('medium');
                strengthText.textContent = 'Medium password';
            } else {
                strengthBar.classList.add('strong');
                strengthText.textContent = 'Strong password';
            }
        });
    }

    const signupForm = document.getElementById('signupForm');
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const btn = document.getElementById('signupBtn');
            const btnText = document.getElementById('btnText');
            const spinner = document.getElementById('loadingSpinner');
            const errorDiv = document.getElementById('errorMessage');
            const successDiv = document.getElementById('successMessage');

            if (password !== confirmPassword) {
                errorDiv.textContent = 'Passwords do not match';
                errorDiv.style.display = 'block';
                return;
            }

            btn.disabled = true;
            btnText.style.display = 'none';
            spinner.style.display = 'inline-block';
            errorDiv.style.display = 'none';
            successDiv.style.display = 'none';

            try {
                console.log('📡 Creating user:', email);

                const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                const user = userCredential.user;

                console.log('✅ User created:', user.uid);

                await user.updateProfile({ displayName: name });
                console.log('✅ Profile updated');

                // Save to Firestore
                try {
                    await firestore.collection('users').doc(user.uid).set({
                        name: name,
                        email: email,
                        uid: user.uid,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
                        loginCount: 1,
                        role: 'user',
                        status: 'active'
                    });
                    console.log('✅ Firestore saved');
                } catch (err) {
                    console.error('Firestore error:', err);
                }

                // Save to Realtime DB
                try {
                    await realtimeDb.ref(`users/${user.uid}`).set({
                        name: name,
                        email: email,
                        uid: user.uid,
                        createdAt: new Date().toISOString(),
                        lastLogin: new Date().toISOString(),
                        loginCount: 1,
                        device: navigator.userAgent,
                        role: 'user',
                        status: 'active'
                    });
                    console.log('✅ Realtime DB saved');
                } catch (err) {
                    console.error('Realtime DB error:', err);
                }

                successDiv.textContent = 'Account created! Redirecting...';
                successDiv.style.display = 'block';

                setTimeout(() => {
                    window.location.href = '../host/index.html';
                }, 2000);

            } catch (error) {
                console.error('❌ Signup error:', error);

                errorDiv.textContent = error.message;
                errorDiv.style.display = 'block';

                btn.disabled = false;
                btnText.style.display = 'inline';
                spinner.style.display = 'none';
            }
        });
    }
}