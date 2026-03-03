const firebaseConfig = {
    apiKey: "AIzaSyBEY1V9m8UIkgWUKJIbdhUuQKCo2I4rztM",
    authDomain: "live-stream-7b16a.firebaseapp.com",
    databaseURL: "https://live-stream-7b16a-default-rtdb.firebaseio.com",
    projectId: "live-stream-7b16a",
    storageBucket: "live-stream-7b16a.firebasestorage.app",
    messagingSenderId: "13367877746",
    appId: "1:13367877746:web:7950e063fee3c01109a2eb"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Get Firebase services
const auth = firebase.auth();
const firestore = firebase.firestore();
const realtimeDb = firebase.database();

// ✅ IMPORTANT: Set persistence for Netlify
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(() => console.log('✅ Auth persistence set to LOCAL'))
    .catch((error) => console.error('Auth persistence error:', error));

console.log('✅ Firebase initialized for Netlify');

// Enable Firestore persistence
firestore.enablePersistence({ synchronizeTabs: true })
    .then(() => console.log('✅ Firestore persistence enabled'))
    .catch((err) => {
        if (err.code == 'failed-precondition') {
            console.log('Multiple tabs open, persistence enabled in one tab only');
        } else if (err.code == 'unimplemented') {
            console.log('Browser does not support persistence');
        }
    });

// Check if user is already logged in
auth.onAuthStateChanged((user) => {
    console.log('Auth state changed:', user ? user.email : 'No user');
    if (user) {
        if (window.location.pathname.includes('login.html') ||
            window.location.pathname.includes('signup.html')) {
            window.location.href = '../host/index.html';
        }
    }
});

// LOGIN PAGE
if (window.location.pathname.includes('login.html')) {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
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
            // Sign in user
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            const user = userCredential.user;

            console.log('✅ User logged in:', user.email);

            // Update login info in Firestore
            await firestore.collection('users').doc(user.uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
                loginCount: firebase.firestore.FieldValue.increment(1)
            }).catch(err => console.log('Firestore update error:', err));

            // Update login info in Realtime Database
            await realtimeDb.ref(`users/${user.uid}/lastLogin`).set({
                timestamp: new Date().toISOString(),
                device: navigator.userAgent
            }).catch(err => console.log('Realtime DB update error:', err));

            // Redirect on success
            window.location.href = '../host/index.html';

        } catch (error) {
            console.error('Login error:', error);

            // Show error
            errorDiv.textContent = error.message;
            errorDiv.style.display = 'block';

            btn.disabled = false;
            btnText.style.display = 'inline';
            spinner.style.display = 'none';
        }
    });
}

// SIGNUP PAGE
if (window.location.pathname.includes('signup.html')) {
    const passwordInput = document.getElementById('password');
    const strengthBar = document.getElementById('strengthBar');
    const strengthText = document.getElementById('strengthText');

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

    document.getElementById('signupForm').addEventListener('submit', async (e) => {
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
            console.log('📡 Creating user with email:', email);

            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;

            console.log('✅ User created in Auth:', user.uid);

            await user.updateProfile({ displayName: name });
            console.log('✅ User profile updated');

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
                console.log('✅ User saved to Firestore');
            } catch (err) {
                console.error('Firestore error:', err);
            }

            // Save to Realtime Database
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
                console.log('✅ User saved to Realtime Database');
            } catch (err) {
                console.error('Realtime DB error:', err);
            }

            successDiv.textContent = 'Account created successfully! Redirecting...';
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