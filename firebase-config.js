/* Projet Firebase « voyage-interactif » (compte quentin@arch-in-tech.com). Ces valeurs sont publiques par nature :
   la sécurité vient des règles Firestore. */
export const firebaseConfig = {
  apiKey: "AIzaSyD69h8T9LjV-oY2jnKFyXZ6XmLBqu_iX-8",
  authDomain: "voyage-interactif.firebaseapp.com",
  projectId: "voyage-interactif",
  storageBucket: "voyage-interactif.firebasestorage.app",
  messagingSenderId: "5495261177",
  appId: "1:5495261177:web:d5368d4b9241e5637c9f28"
};
/* Éditeur principal (doit être identique à celui écrit dans firestore.rules). */
export const OWNER_EMAIL = "q.theuninck@gmail.com";
/* Prénom affiché dans le message d'erreur du code. */
export const OWNER_NAME = "Quentin";
/* Tests locaux seulement : { host: "127.0.0.1" } pour utiliser les émulateurs Firebase. Laisser null en ligne. */
export const emulators = null;
