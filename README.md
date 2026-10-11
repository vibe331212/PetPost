# PetPost

A social app for pets. Share photos, videos and moments, Lick and comment on posts (comments are named after your pet's sound, like Bark, Meow or Neigh), set training goals and earn trophies. It has 15 animated modes and can be installed on your phone's home screen. It also works offline.

Everything is stored on the device in the browser (IndexedDB). There is no server.

## Run locally

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173.

## iPhone app

`ios/` holds an Xcode project that wraps the web app for the App Store, the same way Daybloom does.
The web files are copied into the app when it builds and served from `petpost://app/`.
In the app, care needs become real iPhone notifications, and Save and Share open the iPhone share sheet.

Upload a build to App Store Connect (needs a paid Apple Developer account):

```bash
ios/upload-to-testflight.sh YOUR_TEAM_ID
```
