/* Valeurs à remplacer : console Firebase > Paramètres du projet > Vos applications > Application Web (</>). */
export const firebaseConfig = {
  apiKey: "REMPLACER",
  authDomain: "REMPLACER.firebaseapp.com",
  projectId: "REMPLACER",
  storageBucket: "REMPLACER.firebasestorage.app",
  messagingSenderId: "REMPLACER",
  appId: "REMPLACER"
};
/* Éditeur principal (doit être identique à celui écrit dans firestore.rules et storage.rules). */
export const OWNER_EMAIL = "q.theuninck@gmail.com";
/* Prénom affiché dans le message d'erreur du code. */
export const OWNER_NAME = "Quentin";
/* Tests locaux seulement : { host: "127.0.0.1" } pour utiliser les émulateurs Firebase. Laisser null en ligne. */
export const emulators = null;
