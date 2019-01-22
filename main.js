// Modules to control application life and create native browser window
const path = require('path')
var fp = require("find-free-port")
const {app, BrowserWindow,Tray,Menu,session, protocol,ipcMain, clipboard, shell, Notification} = require('electron')
const fs = require('fs');
const cp = require('child_process');
const origFs = require('original-fs');
const fixPath = require('fix-path');
const log = require('electron-log');
const { autoUpdater } = require("electron-updater");
fixPath();
const notifier = require('node-notifier');


const {fstat} = require('./lib/fs');
console.log('process.env.GSHOST:', process.env.GSHOST)
console.log('process.env.GH_TOKEN:', process.env.GH_TOKEN)

const HOST = process.env.GSHOST || 'gitspeak.com';
// process.noAsar = true;

const gotTheLock = app.requestSingleInstanceLock();

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let main
let splash
let tunnel
let initialUrl = '/';
let state = {
  tunnelPort: null
};
var logQueue = [];

// Start tunnel in separate process to avoid blocking main thread.
// Pages will communicate with this via local websocket server

// Auto updating stuff
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');


autoUpdater.on('checking-for-update', () => {
  devToolsLog('Checking for update...');
})
autoUpdater.on('update-available', (info) => {
  devToolsLog('Update available.');
})
autoUpdater.on('update-not-available', (info) => {
  devToolsLog('Update not available.');
})
autoUpdater.on('error', (err) => {
  devToolsLog('Error in auto-updater. ' + err);
})
autoUpdater.on('download-progress', (progressObj) => {
  let log_message = "Download speed: " + progressObj.bytesPerSecond;
  log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
  log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
  devToolsLog(log_message);
})
autoUpdater.on('update-downloaded', (info) => {
  devToolsLog('Update downloaded');
});

function devToolsLog(text) {
  log.info(text);
  main.webContents.send('message', text);
}

const editMenu = {
    label: "Edit",
    submenu: [
      {
        label: "Undo",
        accelerator: "CmdOrCtrl+Z",
        selector: "undo:"
      },
      {
        label: "Redo",
        accelerator: "Shift+CmdOrCtrl+Z",
        selector: "redo:"
      },
      {
        type: "separator"
      },
      {
        label: "Cut",
        accelerator: "CmdOrCtrl+X",
        selector: "cut:"
      },
      {
        label: "Copy",
        accelerator: "CmdOrCtrl+C",
        selector: "copy:"
      },
      {
        label: "Paste",
        accelerator: "CmdOrCtrl+V",
        selector: "paste:"
      },
      {
        label: "Select All",
        accelerator: "CmdOrCtrl+A",
        selector: "selectAll:"
      }
    ]
  }

var url_scheme = "gitspeak";
protocol.registerStandardSchemes([url_scheme]);
app.setAsDefaultProtocolClient('gitspeak');

function rpc(name,...args){
  var doc = main.webContents;
  var res = doc.send('message',{type: 'rpc', data: [name,args]});
}

function send(name,args){
  if(main && main.webContents) main.webContents.send('message',{type: name, data: args});
}

async function setupTunnel(){
  state.ports = await fp(48000, 49000, '127.0.0.1', 1);
  state.tunnelPort = state.ports[0];

  console.log("tunnel port",state.tunnelPort);

  process.env.TUNNEL_PORT = state.tunnelPort;
  let env = {
    PATH: process.env.PATH, 
    TUNNEL_PORT: state.tunnelPort
  };

  tunnel = cp.fork('./lib/wss', [], {
    env: env,
    cwd: __dirname,
    silent: true
  })

  tunnel.stdout.on('data', (data) => { 
    devToolsLog(String(data));
  })
}

function openIDE(params){
  console.log('open ide',params);
  params.port = state.tunnelPort;
  main.webContents.send('message',{type: 'openSession', data: params});
}


function devToolsLog(s) {
  console.log(s)
  if (main && main.webContents) {
    main.webContents.send('message',{type: 'log', data: s});
  } else {
    logQueue.push(s);
  }
}

async function setupApplication () {
  let opts = {
    width: 420,
    height: 280,
    title: "GitSpeak",
    titleBarStyle: 'hidden',
    hasShadow: false,
    vibrancy: null,
    center: true,
    movable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: true,
    show: false
  }

  // Create loading-screen that will show until we have loaded GitSpeak
  splash = new BrowserWindow(Object.assign({

  },opts));

  splash.once('ready-to-show', function(event, url) {
    splash.show();
    return this;
  });

  splash.loadURL(`file://${__dirname}/splash.html`);

  await setupTunnel();

  // Create the browser window.
  main = new BrowserWindow({
    width: 1280,
    height: 900,
    title: "GitSpeak",
    titleBarStyle: 'hiddenInset',
    vibrancy: null,
    show: false,
    webPreferences: {
      partition: 'persist:main',
      // webSecurity: false,
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true, // should be disabled?
      contextIsolation: false,
      nativeWindowOpen: true,
      backgroundThrottling: false,
      affinity: 'myAffinity'
    }
  })

  main.setMenu(null);
  state.currentWindow = main;
  main.loadURL("https://" + HOST + initialUrl);
  devToolsLog(logQueue);

  main.on('show',function(event){
    if(splash){
      splash.hide();
      splash.destroy();
      splash = null;
    }
  });

  var doc = main.webContents;

  doc.on('will-navigate', function(event, url) {
    return this;
  });

  doc.on('new-window', (event, url, frameName, disposition, options, additionalFeatures) => {
    console.log('new-window',frameName);

    var outerPos = main.getPosition();
    var outerSize = main.getSize();

    var defaults = {}

    if(frameName == 'ghlogin'){
      shell.openExternal(url);
      return;
    }

    if (true) {
      event.preventDefault()
      var frameDefaults = defaults[frameName] || {};
      Object.assign(options, {
        titleBarStyle: 'default',
        modal: false,
        parent: main,
        width: 1020,
        height: 790,
        resizable: false
      },frameDefaults);

      // center over parent window
      options.x = outerPos[0] + Math.round((outerSize[0] - options.width) * 0.5);
      options.y = outerPos[1] + Math.round((outerSize[1] - options.height) * 0.5);

      options.webPreferences = Object.assign({
          preload: path.join(__dirname, 'extwindow.js'),
          partition: 'persist:main',
          affinity: 'myAffinity'
        },
        options.webPreferences,
        frameDefaults.webPreferences || {}
      );

      event.newGuest = new BrowserWindow(options)
      // event.newGuest.on('focus',()=> {state.currentWindow = event.newGuest});
    }
  })

  main.on('close', (e) => {
    if(main.forceClose) return;
    e.preventDefault();
    main.hide();
  })

  // Emitted when the window is closed.
  main.on('closed', function () {
    main = null;
  })
}


ipcMain.on("client", function(event, arg) {
  console.log("ipcmain app",arg);
  return;
  if(arg == 'ready'){
    console.log("ipc ready");
    if(splash && main){
      main.setBounds(splash.getBounds());
      splash.hide();
      splash.destroy();
      splash = null;
      main.show();
    }
  }

  if(arg == 'focus'){
    app.focus();
  }
});


ipcMain.on("state.get", function(event, arg) {
  console.log('state.get',arg);
  event.returnValue = state[arg];
})

ipcMain.on("fstat", function(event, dir) {
  console.log('fstat',dir);
  event.returnValue = fstat(dir);
})

function setupRequestInterceptor(){
  // try to intercept http requests
  const filter = {
    urls: ['https://sindre.gitspeak.com:8443/*', '*://electron.github.io']
  }
  main.webContents.session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    console.log('intercept webRequest!!');
    // details.requestHeaders['User-Agent'] = 'MyAgent'
    callback({cancel: false, requestHeaders: details.requestHeaders})
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', setupApplication)
// app.on('ready', setupRequestInterceptor)

app.on('ready', () => {
  autoUpdater.checkForUpdatesAndNotify();  
})

app.on('open-url', (event,url) => {
  if(main && main.webContents){
    console.log("trying to open url through application! " + url);
    send('openUrl',url);
  } else {
    initialUrl = url.slice(10);
  }
})

app.on('before-quit', () => {
  console.log('before-quit')
  if(main) main.forceClose = true;
  tunnel.send({type: 'kill'});
  tunnel.kill('SIGINT')
});
app.on('will-quit', () => {
  console.log('will-quit')
});

app.on('quit', () => {
  console.log('quit')
});

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  console.log('window-all-closed')
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', function () {
  
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (main === null) {
    // should not be possible(!)
    // createWindow()
  } else {
    console.log("showing main window");
    main.show();
  } 
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
