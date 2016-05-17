'use strict';
var PLUGIN_NAME = 'gulp-shopify-upload';
var shopifyAPI;
var shopify = {};

var $ = {
  through: require('through2'),
  gutil: require('gulp-util'),
  inquirer: require('inquirer'),
  path: require('path'),
  open: require('open'),
  isBinaryFile: require('isbinaryfile'),
  ShopifyApi: require('shopify-api')
};

// Set up shopify API information
shopify._api = false;
shopify._basePath = false;

/*
 * Get the Shopify API instance.
 *
 * @return {ShopifyApi}
 */
shopify._getApi = function(apiKey, password, host) {
  if (!shopify._api) {
    var opts = {auth: apiKey + ':' + password, host: host, port: '443', timeout: 120000};
    shopify._api = new $.ShopifyApi(opts);
  }

  return shopify._api;
};

/*
 * Convert a file path on the local file system to an asset path in shopify
 * as you may run gulp at a higher directory locally.
 *
 * The original path to a file may be something like shop/assets/site.css
 * whereas we require assets/site.css in the API. To customize the base
 * set shopify.options.base config option.
 *
 * @param {string}
 * @return {string}
 */
shopify._makeAssetKey = function(filepath, base) {
  var path = shopify._makePathRelative(filepath, base);
  return encodeURI(path);
};

/*
 * Get the base path.
 *
 * @return {string}
 */
shopify._getBasePath = function(filebase) {
  if (!shopify._basePath) {
    var base = filebase;
    shopify._basePath = (0 < base.length) ? $.path.resolve(base) : process.cwd();
  }

  return shopify._basePath;
};

/**
 * Sets the base path
 *
 * @param {string} basePath
 * @return {void}
 */
shopify._setBasePath = function(basePath) {
  shopify._basePath = basePath;
};

/**
 * Make a path relative to base path.
 *
 * @param {string} filepath
 * @return {string}
 */
shopify._makePathRelative = function(filepath, base) {
  var basePath = shopify._getBasePath(base);
  var relativePath = $.path.relative(basePath, filepath);
  return relativePath.replace(/\\/g, '/');
};

/**
 * Applies options to plugin
 *
 * @param {object} options
 * @return {void}
 */
shopify._setOptions = function(options) {
  if (!options) {
    return;
  }

  if (options.hasOwnProperty('basePath')) {
    shopify._setBasePath(options.basePath);
  }
};

/*
 * Upload a given file path to Shopify
 *
 * Assets need to be in a suitable directory.
 *      - Liquid templates => 'templates/'
 *      - Liquid layouts => 'layout/'
 *      - Liquid snippets => 'snippets/'
 *      - Theme settings => 'config/'
 *      - General assets => 'assets/'
 *      - Language files => 'locales/'
 *
 * Some requests may fail if those folders are ignored
 * @param {filepath} string - filepath
 * @param {file} string - file name
 * @param {host} string- Shopify URL
 * @param {base} sting - options.basePath
 * @param {themeid} string - Shopify theme
 */
shopify.upload = function(filepath, file, host, base, themeid, cb) {

  var api = shopifyAPI;
  var key = shopify._makeAssetKey(filepath, base);
  var isBinary = $.isBinaryFile(filepath);
  var contents = file.contents;
  var props = {asset: {key: key}};
  var filename = filepath.replace(/^.*[\\\/]/, '');

  if (isBinary) {
    props.asset.attachment = contents.toString('base64');
  } else {
    props.asset.value = contents.toString();
  }

  $.gutil.log($.gutil.colors.gray.dim('Uploading: ' + filename));

  var onUpdate = function(err, resp) {
    if (err && ('ShopifyInvalidRequestError' === err.type)) {
      $.gutil.log($.gutil.colors.red('Error uploading file ' + filepath));
    } else if (!err) {
      $.gutil.log($.gutil.colors.green('Upload Complete: ' + filename));
    } else {
      $.gutil.log($.gutil.colors.red('Error undefined! ' + err.type + ' ' + err.detail));
    }
    cb();
  };

  if (themeid) {
    api.asset.update(themeid, props, onUpdate);
  } else {
    api.assetLegacy.update(props, onUpdate);
  }
};

/*
 * Remove a given file path from Shopify.
 *
 * File should be the relative path on the local filesystem.
 *
 * @param {filepath} string - filepath
 * @param {file} string - file name
 * @param {host} string- Shopify URL
 * @param {base} sting - options.basePath
 * @param {themeid} string - Shopify theme
 */
shopify.destroy = function(filepath, file, host, base, themeid, cb) {

  var api = shopifyAPI;
  var key = shopify._makeAssetKey(filepath, base);
  var filename = filepath.replace(/^.*[\\\/]/, '');

  $.gutil.log($.gutil.colors.red.dim('Removing file: ' + filename));

  var onDestroy = function(err, resp) {
    if (err && ('ShopifyInvalidRequestError' === err.type)) {
      $.gutil.log($.gutil.colors.red('Error removing file: ' + filepath));
    } else if (!err) {
      $.gutil.log($.gutil.colors.green('File removed: ' + filename));
    } else {
      $.gutil.log($.gutil.colors.red('Error undefined! ' + err.type));
    }
    cb();
  };

  if (themeid) {
    api.asset.destroy(themeid, key, onDestroy);
  } else {
    api.assetLegacy.destroy(key, onDestroy);
  }
};

/*
 * Public function for process deployment queue for new files added via the stream.
 * The queue is processed based on Shopify's leaky bucket algorithm that allows
 * for infrequent bursts calls with a bucket size of 40. This regenerates overtime,
 * but offers an unlimited leak rate of 2 calls per second. Use this variable to
 * keep track of api call rate to calculate deployment.
 * https://docs.shopify.com/api/introduction/api-call-limit
 *
 * @param {apiKey} string - Shopify developer api key
 * @param {password} string - Shopify developer api key password
 * @param {host} string - hostname provided from gulp file
 * @param {themeid} string - unique id upload to the Shopify theme
 * @param {options} object - named array of custom overrides.
 */
function gulpShopifyUpload(apiKey, password, host, themeid, options) {

  // queue files provided in the stream for deployment
  var apiBurstBucketSize = 36;
  var fileCount = 0;
  var stream;

  // Set up the API
  shopify._setOptions(options);
  shopifyAPI = shopify._getApi(apiKey, password, host);

  if ('undefined' === typeof apiKey) {
    throw new $.gutil.PluginError(PLUGIN_NAME, 'Error, API Key for shopify does not exist!');
  }
  if ('undefined' === typeof password) {
    throw new $.gutil.PluginError(PLUGIN_NAME, 'Error, password for shopify does not exist!');
  }
  if ('undefined' === typeof host) {
    throw new $.gutil.PluginError(PLUGIN_NAME, 'Error, host for shopify does not exist!');
  }

  shopifyAPI.theme.list(function(err, obj) {
    if (err || !obj.themes) {
      $.gutil.log($.gutil.colors.red(err));
      return;
    }

    if ('BACKDOOR' === themeid) {
      // Secret backdoor to upload to any theme on the fly
      var themes = [];
      obj.themes.forEach(function(theme) {
        var t = theme.id + ' - ' + theme.name;

        if (0 < theme.role.length) {
          t += ' (' + theme.role + ')';
        }

        themes.push(t);
      });

      $.inquirer.prompt([
        {
          type: 'list',
          name: 'theme',
          message: 'Which theme would you like to use?',
          choices: themes,
          filter: function(val) {
            var fullName = val.match(/(\d+) - (.*)/);
            return {id: fullName[1], name: fullName[2]};
          }
        }
      ], function(answers) {
        var downcasedName = answers.theme.name.toLowerCase();

        if (/(production|staging)/.test(downcasedName)) {
          $.gutil.log($.gutil.colors.red('\n\nDIRECTLY UPLOADING TO A CLIENT FACING ENVIRONMENT -- CAREFUL!\n\n'));
        }

        themeid = answers.theme.id;
        $.gutil.log($.gutil.colors.gray('Connected to: ') +
          $.gutil.colors.magenta(host) +
          $.gutil.colors.gray(' theme id: ') +
          $.gutil.colors.magenta(answers.theme.id) +
          $.gutil.colors.gray(' theme name: ') +
          $.gutil.colors.magenta(answers.theme.name));
        $.open('http://' + host + '?preview_theme_id=' + answers.theme.id);
      });

      return;
    }

    // validate that the themeid passed in to see if it's an actual themeid
    themeid = parseInt(themeid);  // convert string to int
    var themeidValid = false;
    var themeName;

    obj.themes.forEach(function(theme) {
      if (theme.id == themeid) {
        themeidValid = true;
        themeName = theme.name;
      }
    });

    if (themeidValid) {
      $.gutil.log($.gutil.colors.gray('Connected to: ') +
        $.gutil.colors.magenta(host) +
        $.gutil.colors.gray(' theme id: ') +
        $.gutil.colors.magenta(themeid) +
        $.gutil.colors.gray(' theme name: ') +
        $.gutil.colors.magenta(themeName));
      $.open('http://' + host + '?preview_theme_id=' + themeid);
    } else {
      throw new $.gutil.PluginError(PLUGIN_NAME, 'Error, please make sure you\'re using a real theme id');
    }

  });

  // creating a stream through which each file will pass
  stream = $.through.obj(function(file, enc, cb) {
    if (file.isStream()) {
      this.emit('error', new $.gutil.PluginError(PLUGIN_NAME, 'Streams are not supported!'));
      return cb();
    }

    var self = this;

    if (null === themeid || file.path.indexOf('.DS_Store') !== -1) {
      self.push(file);
      cb();
      return;
    }

    if (file.isBuffer()) {
      // deploy immediately if within the burst bucket size, otherwise queue
      if (fileCount <= apiBurstBucketSize) {
        shopify.upload(file.path, file, host, '', themeid, function() {
          self.push(file);
          cb();
        });
      } else {
        // Delay deployment based on position in the array to deploy 2 files per second
        // after hitting the initial burst bucket limit size
        setTimeout(shopify.upload.bind(null, file.path, file, host, '', themeid, function() {
          self.push(file);
          cb();
        }), ((fileCount - apiBurstBucketSize) / 2) * 1000);
      }
      fileCount++;
    }

    // If file is removed locally, destroy it on Shopify
    if (file.isNull()) {
      // Remove immediately if within the burst bucket size, otherwise queue
      if (fileCount <= apiBurstBucketSize) {
        shopify.destroy(file.path, file, host, '', themeid, function() {
          self.push(file);
          cb();
        });
      } else {
        // Delay removal based on position in the array to deploy 2 files per second
        // after hitting the initial burst bucket limit size
        setTimeout(shopify.destroy.bind(null, file.path, file, host, '', themeid, function() {
          self.push(file);
          cb();
        }), ((fileCount - apiBurstBucketSize) / 2) * 1000);
      }
      fileCount++;
    }

  });

  // returning the file stream
  return stream;
}

// exporting the plugin main function
module.exports = gulpShopifyUpload;
