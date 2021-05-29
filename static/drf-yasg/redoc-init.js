"use strict";

var currentPath = window.location.protocol + "//" + window.location.host + window.location.pathname;
var specURL = currentPath + '?format=openapi';
var redoc = document.createElement("redoc");

var redocSettings = JSON.parse(document.getElementById('redoc-settings').innerHTML);
if (redocSettings.url) {
    specURL = redocSettings.url;
}
delete redocSettings.url;
if (redocSettings.fetchSchemaWithQuery) {
    var query = new URLSearchParams(window.location.search || '').entries();
    var url = specURL.split('?');
    var usp = new URLSearchParams(url[1] || '');
    for (var it = query.next(); !it.done; it = query.next()) {
        usp.set(it.value[0], it.value[1]);
    }
    url[1] = usp.toString();
    specURL = url[1] ? url.join('?') : url[0];
}
delete redocSettings.fetchSchemaWithQuery;

redoc.setAttribute("spec-url", specURL);

function camelToKebab(str) {
    return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

for (var p in redocSettings) {
    if (redocSettings.hasOwnProperty(p)) {
        if (redocSettings[p] !== null && redocSettings[p] !== undefined && redocSettings[p] !== false) {
            redoc.setAttribute(camelToKebab(p), redocSettings[p].toString());
        }
    }
}

document.body.replaceChild(redoc, document.getElementById('redoc-placeholder'));

function hideEmptyVersion() {
    // 'span.api-info-version' is for redoc 1.x, 'div.api-info span' is for redoc 2-alpha
    var apiVersion = document.querySelector('span.api-info-version') || document.querySelector('div.api-info span');
    if (!apiVersion) {
        console.log("WARNING: could not find API versionString element (span.api-info-version)");
        return;
    }

    var versionString = apiVersion.innerText;
    if (versionString) {
        // trim spaces and surrounding ()
        versionString = versionString.replace(/ /g, '');
        versionString = versionString.replace(/(^\()|(\)$)/g, '');
    }

    if (!versionString) {
        // hide version element if empty
        apiVersion.classList.add("hidden");
    }
}

if (document.querySelector('span.api-info-version') || document.querySelector('div.api-info span')) {
    hideEmptyVersion();
}
else {
    insertionQ('span.api-info-version').every(hideEmptyVersion);
    insertionQ('div.api-info span').every(hideEmptyVersion);
}
