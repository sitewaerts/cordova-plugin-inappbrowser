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

const exec = require('cordova/exec');

const LP = "cordova-plugin-inappbrowser: "

/**
 * @typedef {(event:any,info?:{keepCallback?:boolean})=>void} Callback
 */

class Handler
{
    /**
     * @param {string} url
     * @param {string?} target
     * @param {string?} features
     * @param {Callback} cb
     */
    constructor(url, target, features, cb)
    {
        this.url = url;
        this.target = target;
        this.features = features;
        this.cb = cb;
    }

    /**
     * @param {any} event
     * @param {boolean} [closeConnection]
     */
    fire(event, closeConnection)
    {
        const cb = this.cb;
        if (closeConnection)
        {
            this.cb = null;
            if (_handler === this)
                _handler = null;
        }

        if (!cb)
            console.warn(LP + "cannot fire event (no callback or callback already closed)", event)
        else
            cb(event, {keepCallback: !closeConnection});
    }

    /**
     *
     * @param {string} type
     * @param {boolean?} closeConnection
     */
    fireURLEvent(type, closeConnection){
        this.fire({type: type, url: this._getCurrentUrl()}, closeConnection)
    }

    /**
     * @param {any} error
     * @param {boolean} [closeConnection]
     */
    handleError(error, closeConnection)
    {
        console.error(LP + "error occurred", error);
        this.fire({
            type: 'loaderror',
            url: error.url || this._getCurrentUrl(),
            message: error.message || error,
            code: error.code || 0
        }, closeConnection)
    };

    fireExit()
    {
        this.fire({type: 'exit'}, true)
    };

    closeConnection()
    {
        const cb = this.cb;
        this.cb = null;
        if (_handler === this)
            _handler = null;
        if (!cb)
            return;
        cb({type: 'dummy'}, {keepCallback: false});
    };

    _getCurrentUrl()
    {
        try
        {
            return this.getCurrentUrl();
        } catch (err)
        {
            // blocked by CORS :\
            return null;
        }
    }

    /**
     * @returns {string}
     */
    getCurrentUrl()
    {
        return this.url;
    }


    init()
    {
        this.handleError("init not implemented", true)
    }

    /**
     * @param {string?} url
     */
    loadAfterBeforeload(url)
    {
        this.handleError("loadAfterBeforeload not implemented", true)
    }

    show()
    {
        // ignore
    }

    close()
    {
        if (_handler === this)
            _handler = null;
        // ignore
    }

    /**
     * @param {((result:any)=>void)?} win
     * @param {((error:any)=>void)} fail
     * @param {string} code
     */
    injectScriptCode(win, fail, code)
    {
        fail(LP + "injectScriptCode is not implemented");
    }

    /**
     * @param {((result:any)=>void)?} win
     * @param {((error:any)=>void)} fail
     * @param {string} file
     */
    injectScriptFile(win, fail, file)
    {
        fail(LP + "injectScriptFile is not implemented");
    }

    /**
     * @param {((result:any)=>void)?} win
     * @param {((error:any)=>void)} fail
     * @param {string} code
     */
    injectStyleCode(win, fail, code)
    {
        fail(LP + "injectStyleCode is not implemented");
    }

    /**
     * @param {((result:any)=>void)?} win
     * @param {((error:any)=>void)} fail
     * @param {string} file
     */
    injectStyleFile(win, fail, file)
    {
        fail(LP + "injectStyleCode is not implemented");
    }

}

class HandlerSelf extends Handler
{
    /**
     * @param {string} url
     * @param {string?} target
     * @param {string?} features
     * @param {Callback} cb
     */
    constructor(url, target, features, cb)
    {
        super(url, target, features, cb);
    }

    init()
    {
        try
        {
            this.closeConnection();
            window.location = this.url;
            // this.loadStop(); // won't ever be called
        } catch (e)
        {
            this.handleError(e, true);
        }
    }

}

class HandlerSystem extends Handler
{
    /**
     * @param {string} url
     * @param {string?} target
     * @param {string?} features
     * @param {Callback} cb
     */
    constructor(url, target, features, cb)
    {
        super(url, target, features, cb);
    }

    init()
    {
        exec(() =>
        {
            this.fireURLEvent('loadstop', true)
        }, (error) =>
        {
            this.handleError(error, true);
        }, 'InAppBrowserBackend', 'openInSystemBrowser', [this.url]);
    }

}

class HandlerInternal extends Handler
{
    /**
     * @param {string} url
     * @param {string?} target
     * @param {string?} features (key=value pairs separated by comma)
     * @param {Callback} cb
     */
    constructor(url, target, features, cb)
    {
        super(url, target, features, cb);
    }

    init()
    {
        const options = {};
        (this.features || '').split(',')

            .map((kvp) =>
            {
                if (!kvp)
                    return null;
                const kvpComps = kvp.split("=");
                if (!kvpComps[0])
                    return null;
                const k = kvpComps[0].trim().toLowerCase();
                if (k.length < 1)
                    return null;
                let v = kvpComps[1];
                if (v)
                    v = v.trim();
                if (v && v.length < 1)
                    v = null;
                if (v === null || v === undefined)
                    v = true;
                else if (v === "true" || v === "yes")
                    v = true;
                else if (v === "false" || v === "no")
                    v = false;
                return {key: k, value: v}

            })
            .forEach((kvp) =>
            {
                if (kvp)
                    options[kvp.key] = kvp.value;
            })

        exec((windowEvent) =>
        {
            switch (windowEvent.type)
            {
                case 'beforeload':
                case 'loadstart':
                case 'loadstop':
                    this.fire({type: windowEvent.type, url: windowEvent.url}, false);
                    break;
                case 'loaderror':
                    this.handleError(windowEvent.error || windowEvent, false);
                    break;
                case 'close':
                    this.close()
                    break;
            }
        }, (error) =>
        {
            this.handleError(error, true);
        }, 'InAppBrowserBackend', 'openInternal', [this.url, options]);

    }

    /**
     * @param {string?} url
     */
    loadAfterBeforeload(url)
    {
        exec(() =>
        {
            // loadstart event already fired by backend window
        }, (error) =>
        {
            // unhandled error
            this.handleError(error, false);
        }, 'InAppBrowserBackend', 'loadAfterBeforeload', [url]);
    }

    show(){
        exec(() =>
        {
        }, (error) =>
        {
            console.error(LP + "cannot show", error);
            this.fireExit();
        }, 'InAppBrowserBackend', 'show', []);
    }

    close(){
        super.close();
        exec(() =>
        {
            this.fireExit();
        }, (error) =>
        {
            console.error(LP + "cannot close", error);
            this.fireExit();
        }, 'InAppBrowserBackend', 'close', []);
    }

    /**
     * @param {((result:any)=>void)?} win
     * @param {((error:any)=>void)} fail
     * @param {string} code
     */
    injectScriptCode(win, fail, code)
    {
        exec(win, fail, 'InAppBrowserBackend', 'injectScriptCode', [code]);
    }

    /**
     * @param {((result:any)=>void)?} win
     * @param {((error:any)=>void)} fail
     * @param {string} file
     */
    injectScriptFile(win, fail, file)
    {
        exec(win, fail, 'InAppBrowserBackend', 'injectScriptFile', [file]);
    }

    /**
     * @param {((result:any)=>void)?} win
     * @param {((error:any)=>void)} fail
     * @param {string} code
     */
    injectStyleCode(win, fail, code)
    {
        exec(win, fail, 'InAppBrowserBackend', 'injectStyleCode', [code]);
    }

    /**
     * @param {((result:any)=>void)?} win
     * @param {((error:any)=>void)} fail
     * @param {string} file
     */
    injectStyleFile(win, fail, file)
    {
        exec(win, fail, 'InAppBrowserBackend', 'injectStyleFile', [file]);
    }

}


/**
 * @param {string} url
 * @returns {Promise<boolean>}
 */
function isWhiteListedForMainWindow(url)
{
    return new Promise((resolve, reject) =>
    {
        exec(resolve, reject, 'InAppBrowserBackend', 'isWhiteListedForMainWindow', [url]);
    })

}

/**
 * @param {string} url
 * @param {string?} target
 * @param {string?} features
 * @param {Callback} cb
 * @returns {Promise<Handler>}
 */
async function resolveHandler(url, target, features, cb)
{
    if (target === '_self')
    {
        if (await isWhiteListedForMainWindow(url))
            return new HandlerSelf(url, target, features, cb);
        return new HandlerInternal(url, target, features, cb);
    }
    if (target === '_system')
        return new HandlerSystem(url, target, features, cb);
    return new HandlerInternal(url, target, features, cb);
}


/**
 * @type {Handler | null}
 */
let _handler;


const IAB = {
    /**
     * @param {Callback} win
     * @param lose
     * @param {string} strUrl
     * @param {string} [target]
     * @param {string} [features]
     */
    open: function (win, lose, [strUrl, target, features])
    {

        IAB.close();

        (async () =>
        {
            _handler = await resolveHandler(strUrl, target, features, win);
            _handler.init();

        })().catch((error) =>
        {
            console.error(LP + "cannot open " + strUrl, error);
            win({type: 'loaderror', url: strUrl}, {keepCallback: false});
        });


    },

    /**
     * @param {null} win
     * @param {(error:any)=>void?} lose
     * @param {string?} url
     */
    loadAfterBeforeload: function (win, lose, [url])
    {
        if (_handler)
            _handler.loadAfterBeforeload(url);
    },
    show: function ()
    {
        if (_handler)
            _handler.show();
    },
    close: function ()
    {
        if (_handler)
        {
            try
            {
                _handler.close();
            } catch (e)
            {
                console.error(LP + "cannot close window", e);
                _handler = null;
                // ignore
            }
        }
    },


    /**
     * @param win
     * @param fail
     * @param {string} code
     */
    injectScriptCode: function (win, fail, [code])
    {
        if (_handler)
        {
            try
            {
                _handler.injectScriptCode(win, fail, code)
            } catch (e)
            {
                console.error(LP + 'Error occurred while trying to inject script code', e);
                if (fail)
                    fail('Error occurred while trying to inject script code: ' + JSON.stringify(e));
            }
        }
    },

    /**
     * @param win
     * @param fail
     * @param {string} file
     */
    injectScriptFile: function (win, fail, [file])
    {
        if (_handler)
        {
            try
            {
                _handler.injectScriptFile(win, fail, file)
            } catch (e)
            {
                console.error(LP + 'Error occurred while trying to inject script file', e);
                if (fail)
                    fail('Error occurred while trying to inject script file: ' + JSON.stringify(e));
            }
        }
    },

    /**
     * @param win
     * @param fail
     * @param {string} code
     */
    injectStyleCode: function (win, fail, [code])
    {
        if (_handler)
        {
            try
            {
                _handler.injectStyleCode(win, fail, code)
            } catch (e)
            {
                console.error(LP + 'Error occurred while trying to inject style code', e);
                if (fail)
                    fail('Error occurred while trying to inject style code: ' + JSON.stringify(e));
            }
        }
    },

    /**
     * @param win
     * @param fail
     * @param {string} file
     */
    injectStyleFile: function (win, fail, [file])
    {
        if (_handler)
        {
            try
            {
                _handler.injectStyleFile(win, fail, file)
            } catch (e)
            {
                console.error(LP + 'Error occurred while trying to inject style file', e);
                if (fail)
                    fail('Error occurred while trying to inject style file: ' + JSON.stringify(e));
            }
        }

    }
};

require('cordova/exec/proxy').add('InAppBrowser', IAB);
