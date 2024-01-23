/*
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
 */

const {BrowserWindow, net} = require('electron');
const {shell} = require('electron');

const LP = "cordova-plugin-inappbrowser-backend: "

// separate partition required. otherwise 'webRequest.onBeforeRequest()' would intercept request in main window
const PARTITION = "inappbrowser";

const EVENTS = {
    LOAD_START: "loadstart",
    LOAD_STOP: "loadstop",
    LOAD_ERROR: "loaderror",
    BEFORE_LOAD: "beforeload",
    CLOSE: "close",
}

/**
 * @param {string} url
 * @returns {Promise<boolean>}
 */
function isWhiteListedForSystem(url)
{
    // TODO: evaluate <allow-intent href="???"/> from config.xml
    return Promise.resolve(true);
}

/**
 * @param {string} url
 * @returns {Promise<boolean>}
 */
function isWhiteListedForMainWindow(url)
{
    // TODO: evaluate <allow-navigation href="???"/> from config.xml
    // or is this already secured by CSP in index.html?
    return Promise.resolve(true);
}

/**
 * @param {string} url
 * @returns {Promise<void>}
 */
function openURLInSystemBrowser(url)
{
    return isWhiteListedForSystem(url).then((allowed) =>
    {
        if (!allowed)
            return Promise.reject({message: url + " denied by app security configuration"});


        const path = _file_plugin_util.urlToFilePath(url);
        if (path)
        {
            return shell.openPath(path)
                .then((error) =>
                {
                    if (error && error.length > 0)
                    {
                        const message = 'Failed opening local file ' + path + " (" + url + ")" + ": " + error;
                        return Promise.reject({message: message});
                    }
                }, (error) =>
                {
                    const message = 'Failed opening local file ' + path + " (" + url + ")" + ": " + (error.message || error);
                    return Promise.reject({message: message, cause: error});
                });
        }
        else
        {
            return shell.openExternal(url)
                .catch((error) =>
                {
                    const message = 'Failed opening ' + url + ": " + (error.message || error);
                    return Promise.reject({message: message, cause: error});
                });
        }


    }, (error) =>
    {
        const message = 'Failed checking white listing for ' + url + ": " + (error.message || error);
        return Promise.reject({message: message, cause: error});
    });
}


/**
 * @param {string} url
 * @return {Promise<void>}
 * @private
 */
function loadURLInIABWindow(url)
{

    // fire loadstart on window level (will-navigate not fired for loadURL())
    _iabWindowCallbackContext.progress({type: EVENTS.LOAD_START, url: url});

    return _iabWindow.loadURL(url).then(() =>
    {
        // did-finish-load already handled
        //_iabWindowCallbackContext.progress({type: EVENTS.LOAD_STOP, url: url});
    }, () =>
    {
        // did-fail-load already handled
        // const message = 'Failed loading ' + url + ": " + (error.message || error);
        // console.error(message, error);
        // _iabWindowCallbackContext.progress({
        //     type: EVENTS.LOAD_ERROR,
        //     url: url,
        //     message: message,
        //     code: error.code || error.status || 0
        // });
    });

}

/**
 *
 * @param {string | number} raw
 * @param {number} defaultValue
 * @returns {number}
 */
function getDimValue(raw, defaultValue)
{
    if (!raw)
        return defaultValue;
    const n = Number(raw);
    if (isNaN(n))
        return defaultValue;
    return n;
}


/**
 * @type {Electron.BrowserWindow}
 */
let _iabWindow;

/**
 * @type {CordovaElectronCallbackContext};
 */
let _iabWindowCallbackContext;

/**
 *
 * @type {boolean}
 */
let _skipOnBefore = false;

// noinspection JSUnusedGlobalSymbols
const pluginAPI = {


    /**
     * @param {string} url
     * @param {CordovaElectronCallbackContext} callbackContext
     * @void
     */
    openInSystemBrowser: ([url], callbackContext) =>
    {
        openURLInSystemBrowser(url).then(
            () =>
            {
                callbackContext.success(true);
            },
            (error) =>
            {
                callbackContext.error({message: error.message, url, cause: error.cause});
            }
        );
    },

    /**
     * @param {string} url
     * @param {Record<string, string | boolean | number>} options
     * @param {CordovaElectronCallbackContext} callbackContext
     * @void
     */
    openInternal: ([url, options], callbackContext) =>
    {
        _skipOnBefore = false;

        if (!url || url.length < 1)
            return callbackContext.error({message: "no url specified", url});

        const hidden = !!options.hidden;
        const beforeLoad = options.beforeload ? options.beforeload.toLowerCase() : null;
        if (beforeLoad === 'post')
            return callbackContext.error({message: "beforeLoad=post currently not supported", url});


        if (_iabWindow)
        {
            // close prior window if any
            if (!_iabWindow.isDestroyed())
                _iabWindow.close();
            _iabWindow = null;
            _iabWindowCallbackContext = null;
        }

        _iabWindowCallbackContext = callbackContext;
        const mainWindow = getMainWindow();
        const dev = mainWindow.webContents.isDevToolsOpened();

        // TODO: window set icon
        _iabWindow = new BrowserWindow({
            width: getDimValue(options.width, mainWindow.getBounds().width),
            height: getDimValue(options.height, mainWindow.getBounds().height),
            modal: !dev, // break point in main window could block processing as we couldn't klick continue there
            parent: mainWindow,
            show: !hidden,
            paintWhenInitiallyHidden: true,
            fullscreen: !!options.fullscreen,
            webPreferences: {
                devTools: dev,
                sandbox: true,
                partition: PARTITION
            }
        });

        // handle window.open and links with target != '_self'
        _iabWindow.webContents.setWindowOpenHandler((details) =>
        {
            openURLInSystemBrowser(details.url).catch((error) =>
            {
                console.error(LP + "cannot open url '" + details.url + "' in system browser", error)
            });
            return {action: 'deny'}
        })

        if (dev)
            _iabWindow.webContents.openDevTools();

        _iabWindow.webContents.setUserAgent(mainWindow.webContents.getUserAgent() + " inappbrowser");

        if (beforeLoad === 'get' || beforeLoad === 'yes')
        {

            _iabWindow.webContents.session.webRequest.onBeforeRequest((details, callback) =>
            {
                if (!_skipOnBefore && details.frame === _iabWindow.webContents.mainFrame && details.method.toLowerCase() === 'get')
                {
                    _skipOnBefore = true;
                    callbackContext.progress({type: EVENTS.BEFORE_LOAD, url: details.url});
                    callback({cancel: true})
                    return;
                }
                callback({cancel: false});

            });
        }
        else
        {
            _iabWindow.webContents.on('will-navigate', (e) =>
            {
                callbackContext.progress({type: EVENTS.LOAD_START, url: e.url});
            });
        }

        _iabWindow.webContents.on('did-finish-load', () =>
        {
            callbackContext.progress({type: EVENTS.LOAD_STOP, url: _iabWindow.webContents.mainFrame.url});
        });

        _iabWindow.webContents.on('did-fail-load', (e, errorCode, errorDescription, validatedURL) =>
        {
            callbackContext.progress({
                type: EVENTS.LOAD_ERROR,
                url: validatedURL,
                message: errorDescription,
                code: errorCode
            });
        });

        _iabWindow.on('closed', () =>
        {
            callbackContext.success({type: EVENTS.CLOSE})
        })

        loadURLInIABWindow(url).catch((error) =>
        {
            // should never happen
            console.error(LP + "unhandled error loading url '" + url + "'", error);
        });

    },


    /**
     * @param {string} url
     * @param {CordovaElectronCallbackContext} callbackContext
     */
    loadAfterBeforeload: ([url], callbackContext) =>
    {
        if (!_iabWindow)
            return callbackContext.error({message: "no window", url});
        if (!url || url.length < 1)
            return callbackContext.error({message: "no url specified", url});
        _skipOnBefore = true;
        loadURLInIABWindow(url).then(
            () =>
            {
                _skipOnBefore = false;
                callbackContext.success();
            },
            (error) =>
            {
                _skipOnBefore = false;
                callbackContext.error(error);
            }
        );
    },

    /**
     * @param {CordovaElectronCallbackContext} callbackContext
     */
    show: ([], callbackContext) =>
    {
        if (!_iabWindow)
            return callbackContext.error("no window");

        _iabWindow.show();
        callbackContext.success();
    },

    /**
     * @param {CordovaElectronCallbackContext} callbackContext
     */
    close: ([], callbackContext) =>
    {
        const w = _iabWindow;
        _iabWindow = null;
        if (w && !w.isDestroyed())
            w.close();
        callbackContext.success();
    },

    /**
     * @param {string} code
     * @param {CordovaElectronCallbackContext} callbackContext
     */
    injectScriptCode: ([code], callbackContext) =>
    {
        if (!_iabWindow)
            return callbackContext.error("no window");
        _iabWindow.webContents.executeJavaScript(code).then(
            (result) =>
            {
                callbackContext.success(result)
            }, (error) =>
            {
                callbackContext.error(error)
            }
        );

    },

    /**
     * @param {string} file
     * @param {CordovaElectronCallbackContext} callbackContext
     */
    injectScriptFile: ([file], callbackContext) =>
    {
        if (!_iabWindow)
            return callbackContext.error("no window");

        net.fetch(file).then((res) =>
        {
            return res.text().then((code) =>
            {
                pluginAPI.injectScriptCode(code, callbackContext)
            });
        }).catch((error) =>
        {
            callbackContext.error(error);
        })
    },

    /**
     * @param {string} code
     * @param {CordovaElectronCallbackContext} callbackContext
     */
    injectStyleCode: ([code], callbackContext) =>
    {
        if (!_iabWindow)
            return callbackContext.error("no window");
        _iabWindow.webContents.insertCSS(code).then(
            () =>
            {
                callbackContext.success()
            }, (error) =>
            {
                callbackContext.error(error)
            }
        );
    },

    /**
     * @param {string} file
     * @param {CordovaElectronCallbackContext} callbackContext
     */
    injectStyleFile: ([file], callbackContext) =>
    {
        if (!_iabWindow)
            return callbackContext.error("no window");
        net.fetch(file).then((res) =>
        {
            return res.text().then((code) =>
            {
                pluginAPI.injectStyleCode(code, callbackContext)
            });
        }).catch((error) =>
        {
            callbackContext.error(error);
        })
    },

    /**
     * @param {string} url
     * @param {CordovaElectronCallbackContext} callbackContext
     */
    isWhiteListedForMainWindow: ([url], callbackContext) =>
    {
        isWhiteListedForMainWindow(url).then(callbackContext.success.bind(callbackContext), callbackContext.error.bind(callbackContext))
    },

}


/** * Plugin ***/




let _initialized = false;

/**
 * @type {CordovaElectronPlugin}
 */
const plugin = function (action, args, callbackContext)
{
    if (!pluginAPI[action])
        return false;
    try
    {
        pluginAPI[action](args, callbackContext)
    } catch (e)
    {
        console.error(action + ' failed', e);
        callbackContext.error({message: action + ' failed', cause: e});
    }
    return true;
}

plugin.configure = (ctx) =>
{
    ctx.enableAllSchemesOnPartition(PARTITION);
}

/**
 * @type {CordovaElectronPluginInitContext}
 */
let _initCtx;

/**
 * @returns {Electron.BrowserWindow}
 */
function getMainWindow()
{
    return _initCtx.getMainWindow();
}

let _file_plugin_util;

plugin.initialize = async (ctx) =>
{
    if (_initialized)
        return Promise.reject(new Error(LP + "already initialized"));
    _initialized = true;

    _initCtx = ctx;
    _file_plugin_util = _file_plugin_util || (await ctx.getService('File')).util

}

module.exports = plugin;
