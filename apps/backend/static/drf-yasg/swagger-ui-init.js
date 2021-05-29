"use strict";
var currentPath = window.location.protocol + "//" + window.location.host + window.location.pathname;
var defaultSpecUrl = currentPath + '?format=openapi';

function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
        .replace(/--+/g, '-')           // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start of text
        .replace(/-+$/, '');            // Trim - from end of text
}

var KEY_AUTH = slugify(window.location.pathname) + "-drf-yasg-auth";

// load the saved authorization state from localStorage; ImmutableJS is used for consistency with swagger-ui state
var savedAuth = Immutable.fromJS({});

// global SwaggerUI config object; can be changed directly or by hooking initSwaggerUiConfig
var swaggerUiConfig = {
    url: defaultSpecUrl,
    dom_id: '#swagger-ui',
    displayRequestDuration: true,
    presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIStandalonePreset
    ],
    plugins: [
        SwaggerUIBundle.plugins.DownloadUrl
    ],
    layout: "StandaloneLayout",
    filter: true,
    requestInterceptor: function (request) {
        var headers = request.headers || {};
        var csrftoken = document.querySelector("[name=csrfmiddlewaretoken]");
        if (csrftoken) {
            headers["X-CSRFToken"] = csrftoken.value;
        }

        return request;
    }
};

function patchSwaggerUi() {
    if (document.querySelector('.auth-wrapper #django-session-auth')) {
        return;
    }

    var authWrapper = document.querySelector('.auth-wrapper');
    var authorizeButton = document.querySelector('.auth-wrapper .authorize');
    var djangoSessionAuth = document.querySelector('#django-session-auth');

    if (!djangoSessionAuth) {
        console.log("WARNING: session auth disabled");
        return;
    }

    djangoSessionAuth = djangoSessionAuth.cloneNode(true);
    authWrapper.insertBefore(djangoSessionAuth, authorizeButton);
    djangoSessionAuth.classList.remove("hidden");
}

function initSwaggerUi() {
    if (window.ui) {
        console.log("WARNING: skipping initSwaggerUi() because window.ui is already defined");
        return;
    }
    if (document.querySelector('.auth-wrapper .authorize')) {
        patchSwaggerUi();
    } else {
        insertionQ('.auth-wrapper .authorize').every(patchSwaggerUi);
    }

    var swaggerSettings = JSON.parse(document.getElementById('swagger-settings').innerHTML);

    var oauth2RedirectUrl = document.getElementById('oauth2-redirect-url');
    if (oauth2RedirectUrl) {
        if (!('oauth2RedirectUrl' in swaggerSettings)) {
            if (oauth2RedirectUrl) {
                swaggerSettings['oauth2RedirectUrl'] = oauth2RedirectUrl.href;
            }
        }
        oauth2RedirectUrl.parentNode.removeChild(oauth2RedirectUrl);
    }

    console.log('swaggerSettings', swaggerSettings);
    var oauth2Config = JSON.parse(document.getElementById('oauth2-config').innerHTML);
    console.log('oauth2Config', oauth2Config);

    initSwaggerUiConfig(swaggerSettings, oauth2Config);
    window.ui = SwaggerUIBundle(swaggerUiConfig);
    window.ui.initOAuth(oauth2Config);
}

/**
 * Initialize the global swaggerUiConfig with any given additional settings.
 * @param swaggerSettings SWAGGER_SETTINGS from Django settings
 * @param oauth2Settings OAUTH2_CONFIG from Django settings
 */
function initSwaggerUiConfig(swaggerSettings, oauth2Settings) {
    var persistAuth = swaggerSettings.persistAuth;
    var refetchWithAuth = swaggerSettings.refetchWithAuth;
    var refetchOnLogout = swaggerSettings.refetchOnLogout;
    var fetchSchemaWithQuery = swaggerSettings.fetchSchemaWithQuery;
    delete swaggerSettings['persistAuth'];
    delete swaggerSettings['refetchWithAuth'];
    delete swaggerSettings['refetchOnLogout'];
    delete swaggerSettings['fetchSchemaWithQuery'];

    for (var p in swaggerSettings) {
        if (swaggerSettings.hasOwnProperty(p)) {
            swaggerUiConfig[p] = swaggerSettings[p];
        }
    }

    var specURL = swaggerUiConfig.url;
    if (fetchSchemaWithQuery) {
        // only add query params from document for the first spec request
        // this ensures we otherwise honor the spec selector box which might be manually modified
        var query = new URLSearchParams(window.location.search || '').entries();
        for (var it = query.next(); !it.done; it = query.next()) {
            specURL = setQueryParam(specURL, it.value[0], it.value[1]);
        }
    }
    if (persistAuth) {
        try {
            savedAuth = Immutable.fromJS(JSON.parse(localStorage.getItem(KEY_AUTH)) || {});
        } catch (e) {
            localStorage.removeItem(KEY_AUTH);
        }
    }
    if (refetchWithAuth) {
        specURL = applyAuth(savedAuth, specURL) || specURL;
    }
    swaggerUiConfig.url = specURL;

    if (persistAuth || refetchWithAuth) {
        var hookedAuth = false;

        var oldOnComplete = swaggerUiConfig.onComplete;
        swaggerUiConfig.onComplete = function () {
            if (persistAuth) {
                preauthorizeAll(savedAuth, window.ui);
            }

            if (!hookedAuth) {
                hookAuthActions(window.ui, persistAuth, refetchWithAuth, refetchOnLogout);
                hookedAuth = true;
            }
            if (oldOnComplete) {
                oldOnComplete();
            }
        };

        var specRequestsInFlight = {};
        var oldRequestInterceptor = swaggerUiConfig.requestInterceptor;
        swaggerUiConfig.requestInterceptor = function (request) {
            var headers = request.headers || {};
            if (request.loadSpec) {
                var newUrl = request.url;
                if (refetchWithAuth) {
                    newUrl = applyAuth(savedAuth, newUrl, headers) || newUrl;
                }

                if (newUrl !== request.url) {
                    request.url = newUrl;

                    if (window.ui) {
                        // this visually updates the spec url before the request is done, i.e. while loading
                        window.ui.specActions.updateUrl(request.url);
                    } else {
                        // setTimeout is needed here because the request interceptor can be called *during*
                        // window.ui initialization (by the SwaggerUIBundle constructor)
                        setTimeout(function () {
                            window.ui.specActions.updateUrl(request.url);
                        });
                    }

                    // need to manually remember requests for spec urls because
                    // responseInterceptor has no reference to the request...
                    var absUrl = new URL(request.url, currentPath);
                    specRequestsInFlight[absUrl.href] = request.url;
                }
            }

            if (oldRequestInterceptor) {
                request = oldRequestInterceptor(request);
            }
            return request;
        };

        var oldResponseInterceptor = swaggerUiConfig.responseInterceptor;
        swaggerUiConfig.responseInterceptor = function (response) {
            var absUrl = new URL(response.url, currentPath);
            if (absUrl.href in specRequestsInFlight) {
                var setToUrl = specRequestsInFlight[absUrl.href];
                delete specRequestsInFlight[absUrl.href];
                if (response.ok) {
                    // need setTimeout here because swagger-ui insists to call updateUrl
                    // with the initial request url after the response...
                    setTimeout(function () {
                        var currentUrl = new URL(window.ui.specSelectors.url(), currentPath);
                        if (currentUrl.href !== absUrl.href) {
                            window.ui.specActions.updateUrl(setToUrl);
                        }
                    });
                }
            }

            if (oldResponseInterceptor) {
                response = oldResponseInterceptor(response);
            }
            return response;
        }
    }
}

function _usp(url, fn) {
    url = url.split('?');
    var usp = new URLSearchParams(url[1] || '');
    fn(usp);
    url[1] = usp.toString();
    return url[1] ? url.join('?') : url[0];
}

function setQueryParam(url, key, value) {
    return _usp(url, function (usp) {
        usp.set(key, value);
    });
}

function removeQueryParam(url, key) {
    return _usp(url, function (usp) {
        usp.delete(key);
    })
}

/**
 * Call sui.preauthorize### for all authorizations in authorization.
 * @param authorization authorization object {key => authScheme} saved from authActions.authorize
 * @param sui SwaggerUI or SwaggerUIBundle instance
 */
function preauthorizeAll(authorization, sui) {
    authorization.valueSeq().forEach(function (authScheme) {
        var schemeName = authScheme.get("name"), schemeType = authScheme.getIn(["schema", "type"]);
        if (schemeType === "basic" && schemeName) {
            var username = authScheme.getIn(["value", "username"]);
            var password = authScheme.getIn(["value", "password"]);
            if (username && password) {
                sui.preauthorizeBasic(schemeName, username, password);
            }
        } else if (schemeType === "apiKey" && schemeName) {
            var key = authScheme.get("value");
            if (key) {
                sui.preauthorizeApiKey(schemeName, key);
            }
        } else {
            // TODO: OAuth2
        }
    });
}

/**
 * Manually apply auth headers from the given auth object.
 * @param {object} authorization authorization object {key => authScheme} saved from authActions.authorize
 * @param {string} requestUrl the request url
 * @param {object} requestHeaders target headers, modified in place by the function
 * @return string new request url
 */
function applyAuth(authorization, requestUrl, requestHeaders) {
    authorization.valueSeq().forEach(function (authScheme) {
        requestHeaders = requestHeaders || {};
        var schemeName = authScheme.get("name"), schemeType = authScheme.getIn(["schema", "type"]);
        if (schemeType === "basic" && schemeName) {
            var username = authScheme.getIn(["value", "username"]);
            var password = authScheme.getIn(["value", "password"]);
            if (username && password) {
                requestHeaders["Authorization"] = "Basic " + btoa(username + ":" + password);
            }
        } else if (schemeType === "apiKey" && schemeName) {
            var _in = authScheme.getIn(["schema", "in"]), paramName = authScheme.getIn(["schema", "name"]);
            var key = authScheme.get("value");
            if (key && paramName) {
                if (_in === "header") {
                    requestHeaders[paramName] = key;
                }
                if (_in === "query") {
                    if (requestUrl) {
                        requestUrl = setQueryParam(requestUrl, paramName, key);
                    } else {
                        console.warn("WARNING: cannot apply apiKey query parameter via interceptor");
                    }
                }
            }
        } else {
            // TODO: OAuth2
        }
    });

    return requestUrl;
}

/**
 * Remove the given authorization scheme from the url.
 * @param {object} authorization authorization object {key => authScheme} containing schemes to deauthorize
 * @param {string} requestUrl request url
 * @return string new request url
 */
function deauthUrl(authorization, requestUrl) {
    authorization.valueSeq().forEach(function (authScheme) {
        var schemeType = authScheme.getIn(["schema", "type"]);
        if (schemeType === "apiKey") {
            var _in = authScheme.getIn(["schema", "in"]), paramName = authScheme.getIn(["schema", "name"]);
            if (_in === "query" && requestUrl && paramName) {
                requestUrl = removeQueryParam(requestUrl, paramName);
            }
        } else {
            // TODO: OAuth2?
        }
    });
    return requestUrl;
}

/**
 * Hook the authorize and logout actions of SwaggerUI.
 * The hooks are used to persist authorization data and trigger schema refetch.
 * @param sui SwaggerUI or SwaggerUIBundle instance
 * @param {boolean} persistAuth true to save auth to local storage
 * @param {boolean} refetchWithAuth true to trigger schema fetch on login
 * @param {boolean} refetchOnLogout true to trigger schema fetch on logout
 */
function hookAuthActions(sui, persistAuth, refetchWithAuth, refetchOnLogout) {
    if (!persistAuth && !refetchWithAuth) {
        // nothing to do
        return;
    }

    var originalAuthorize = sui.authActions.authorize;
    sui.authActions.authorize = function (authorization) {
        originalAuthorize(authorization);
        // authorization is map of scheme name to scheme object
        // need to use ImmutableJS because schema is already an ImmutableJS object
        var newAuths = Immutable.fromJS(authorization);
        savedAuth = savedAuth.merge(newAuths);

        if (refetchWithAuth) {
            var url = sui.specSelectors.url();
            url = applyAuth(savedAuth, url) || url;
            sui.specActions.updateUrl(url);
            sui.specActions.download();
            sui.authActions.showDefinitions(); // hide authorize dialog
        }
        if (persistAuth) {
            localStorage.setItem(KEY_AUTH, JSON.stringify(savedAuth.toJSON()));
        }
    };

    var originalLogout = sui.authActions.logout;
    sui.authActions.logout = function (authorization) {
        // stash logged out methods for use with deauthUrl
        var loggedOut = savedAuth.filter(function (val, key) {
            return authorization.indexOf(key) !== -1;
        }).mapEntries(function (entry) {
            return [entry[0], entry[1].set("value", null)]
        });
        // remove logged out methods from savedAuth
        savedAuth = savedAuth.filter(function (val, key) {
            return authorization.indexOf(key) === -1;
        });

        if (refetchWithAuth) {
            var url = sui.specSelectors.url();
            url = deauthUrl(loggedOut, url) || url;
            sui.specActions.updateUrl(url);
            sui.specActions.download(url);
            sui.authActions.showDefinitions(); // hide authorize dialog
        }
        if (persistAuth) {
            localStorage.setItem(KEY_AUTH, JSON.stringify(savedAuth.toJSON()));
        }
        originalLogout(authorization);
    };
}

window.addEventListener('load', initSwaggerUi);
