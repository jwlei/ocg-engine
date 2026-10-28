// Project settings. Paste your Firebase web app config from
// Firebase console → Project settings → General → Your apps → SDK setup and configuration.
// While apiKey is "REPLACE_ME", the game runs in local mode with an in-memory database.
(globalThis.OCG ??= {}).config = {
    firebase: {
        apiKey: "REPLACE_ME",
        authDomain: "your-project.firebaseapp.com",
        databaseURL: "https://your-project-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "your-project",
        appId: "REPLACE_ME"
    },
    // Game offered first on the home screen (an id registered with OCG.games.register).
    defaultGame: "climb",
    title: "OCG Engine"
};
