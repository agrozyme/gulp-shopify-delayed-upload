'use strict';

var $ = require('autoload-modules')({
  mapping: {'promise': require('bluebird'), 'shopify': 'shopify-api-node'}
});

$.async = $.asyncawait.async;
$.await = $.asyncawait.await;

$.gulpShopifyDelayedUpload = function(options) {
  if (false === this instanceof $.gulpShopifyDelayedUpload) {
    return new $.gulpShopifyDelayedUpload(options);
  }

  const that = this;
  const prototype = $.gulpShopifyDelayedUpload.prototype;
  const pluginName = 'gulp-shopify-delayed-upload';

  var self = {};

  /** @prop {$.shopify} that.api */
  self.api = false;

  self.isWatch = false;

  self.count = {stream: 0, buffer: 0, empty: 0};

  self.error = {stream: [], buffer: [], empty: []};

  self.options = {
    key: '', pass: '', name: '', theme_id: '', theme_name: '', basePath: '', host: '', preview: '', openBrowser: false
  };

  prototype.constructor = function(options) {
    const that = this;
    that.setOptions(options);
    return that;
  };

  prototype.getOptions = function() {
    return JSON.parse(JSON.stringify(self.options));
  };

  prototype.setOptions = function(options) {
    self.options = that.mergeOptions(options);
  };

  prototype.mergeOptions = function(options) {
    var items = {};
    var data = self.options;

    for (var name in data) {
      if (data.hasOwnProperty(name)) {
        items[name] = (options.hasOwnProperty(name)) ? options[name] : data[name];
      }
    }

    items.host = items.name + '.myshopify.com';
    items.preview = 'http://' + items.host + '?preview_theme_id=' + items.theme_id;
    items.basePath = (0 < items.basePath.length) ? $.path.resolve(items.basePath) : process.cwd();
    return items;
  };

  prototype.validateOptions = function() {
    var options = self.options;
    var error = $.gulpUtil.PluginError;

    if ('undefined' === typeof options.key) {
      throw new error(pluginName, 'Error, API Key for shopify does not exist!');
    }

    if ('undefined' === typeof options.pass) {
      throw new error(pluginName, 'Error, password for shopify does not exist!');
    }

    if ('undefined' === typeof options.host) {
      throw new error(pluginName, 'Error, host for shopify does not exist!');
    }

    return true;
  };

  prototype.getApi = function() {
    if (!self.api) {
      var options = self.options;
      self.api = new $.shopify(options.name, options.key, options.pass);
    }

    return self.api;
  };

  prototype.makePathRelative = function(path) {
    return $.path.relative(self.options.basePath, path).replace(/\\/g, '/');
  };

  prototype.makeAssetKey = function(path) {
    var relative = $.path.relative(self.options.basePath, path).replace(/\\/g, '/');
    return encodeURI(relative);
  };

  prototype.log = function(message, style) {
    var util = $.gulpUtil;
    var callback = style || util.colors.gray;
    util.log(callback(message));
  };

  prototype.getFileName = function(file) {
    return file.path.replace(/^.*[\\\/]/, '');
  };

  prototype.updateAsset = $.async(function(file) {
    var that = this;
    var data = {asset: {key: that.makeAssetKey(file.path)}};
    var filename = data.asset.key;
    var colors = $.gulpUtil.colors;

    data.asset.attachment = file.contents.toString('base64');
    that.log('Upload Start:  ' + filename, colors.gray);

    var action = that.getApi().asset.update(self.options.theme_id, data.asset).then(function(data) {
      that.log('Upload Finish: ' + filename, colors.green);
      return data;
    }).catch(function(error) {
      that.log(error.message, colors.red);
      that.log('Upload Error:  ' + filename, colors.red);
    });

    var item = $.await(action);
    $.await(that.delay());
    return item;
  });

  prototype.deleteAsset = $.async(function(file) {
    var that = this;
    var data = {asset: {key: that.makeAssetKey(file.path)}};
    var filename = data.asset.key;
    var colors = $.gulpUtil.colors;

    that.log('Delete Start:  ' + filename, colors.red);

    var action = that.getApi().asset.delete(self.options.theme_id, data).then(function(data) {
      that.log('Delete Finish: ' + filename, colors.green);
      return data;
    }).catch(function(error) {
      that.log(error.message, colors.red);
      that.log('Delete Error:  ' + filename, colors.red);
    });

    var item = $.await(action);
    $.await(that.delay());
    return item;
  });

  prototype.showConnectionMessage = function() {
    var options = self.options;
    var colors = $.gulpUtil.colors;
    var items = [];

    items.push(colors.gray('Connected to: ') +
      colors.magenta(options.host) +
      colors.gray(' theme id: ') +
      colors.magenta(options.theme_id) +
      colors.gray(' theme name: ') +
      colors.magenta(options.theme_name));

    items.push(colors.gray('Browser to: ') +
      colors.magenta('http://' + options.host + '?preview_theme_id=' + options.theme_id));

    items.forEach(function(item) {
      $.gulpUtil.log(item);
    });
  };

  prototype.buildThemeChoices = function(themes) {
    var items = [];

    for (var index in themes) {
      if (themes.hasOwnProperty(index)) {
        var theme = themes[index];
        var item = {name: theme.id + ' - ' + theme.name, short: theme.name};

        if (0 < theme.role.length) {
          item.name += ' (' + theme.role + ')';
        }

        item.value = {id: theme.id, name: theme.name};
        items.push(item);
      }
    }

    return items;
  };

  prototype.delay = $.async(function() {
    var that = this;
    var limit = that.getApi().callLimits;
    var time = (limit && (0.5 < (limit.current / limit.max))) ? 1000 : 0;
    $.await($.promise.delay(time));
  });

  prototype.getThemes = $.async(function() {
    var that = this;
    var items = {};
    var themes = $.await(that.getApi().theme.list());

    themes.forEach(function(theme) {
      items[theme.id] = theme;
    });

    $.await(that.delay());
    return items;
  });

  prototype.selectTheme = $.async(function(themes) {
    var that = this;
    var error = $.gulpUtil.PluginError;

    if (0 === Object.keys(themes).length) {
      throw new error(pluginName, 'Error: Can not get any themes.');
    }

    var questions = [
      {
        type: 'list',
        name: 'theme',
        message: 'Which theme would you like to use?',
        choices: that.buildThemeChoices(themes)
      }
    ];

    return $.await($.inquirer.prompt(questions));
  });

  prototype.prepareUpload = $.async(function() {
    var that = this;
    var options = that.getOptions();
    var themes = $.await(that.getThemes());

    if (themes.hasOwnProperty(options.theme_id)) {
      options.theme_name = themes[options.theme_id].name;
    } else {
      var data = $.await(that.selectTheme(themes));
      options.theme_id = data.id;
      options.theme_name = data.name;
    }

    that.setOptions(options);
    that.validateOptions();
    that.showConnectionMessage();

    if (options.openBrowser) {
      $.open(options.preview);
    }
  });

  prototype.validateUploadFile = function(file) {
    var that = this;
    var options = self.options;
    var test = true;
    test = test && (false === file.isDirectory());
    test = test && (null !== options.theme_id);
    test = test && (-1 === file.path.indexOf('.DS_Store'));
    return test;
  };

  prototype.getFileType = function(file) {
    var types = {stream: file.isStream(), buffer: file.isBuffer(), empty: file.isNull()};

    for (var index in types) {
      if (types.hasOwnProperty(index) && types[index]) {
        return index;
      }
    }

    return '';
  };

  prototype.uploadFile = function(file, encoding, callback, stream) {
    var that = this;
    var count = self.count;
    var errorFiles = self.error;
    var type = that.getFileType(file);

    var doCatch = function(error) {
      var colors = $.gulpUtil.colors;
      that.log(error.message, colors.red);

      if (errorFiles.hasOwnProperty(type)) {
        errorFiles[type].push(file.path);
      }
    };

    var doFinally = function() {
      if ((false === file.isDirectory()) && count.hasOwnProperty(type)) {
        count[type]--;
      }

      stream.push(file);
      that.showCountMessage();
      callback();
    };

    if (false === that.validateUploadFile(file)) {
      doFinally();
      return;
    }

    if (count.hasOwnProperty(type)) {
      count[type]++;
    }

    if (file.isStream()) {
      // this.emit('error', new $.gulpUtil.PluginError(pluginName, 'Streams are not supported!'));
      doCatch(new Error('Streams are not supported!'));
      doFinally();
    }

    if (file.isBuffer()) {
      that.updateAsset(file).catch(doCatch).finally(doFinally);
    }

    if (file.isNull()) {
      that.deleteAsset(file).catch(doCatch).finally(doFinally);
    }
  };

  prototype.showCountMessage = function() {
    var that = this;
    var count = self.count;
    var colors = $.gulpUtil.colors;
    var text = colors.gray('Stream count: ') +
      colors.magenta(count.stream) +
      colors.gray(' Buffer count: ') +
      colors.magenta(count.buffer) +
      colors.gray(' Empty count: ') +
      colors.magenta(count.empty);
    that.log(text);
  };

  prototype.streamUpload = function() {
    var that = this;

    return $.through2.obj(function(file, encoding, callback) {
      var stream = this;
      that.uploadFile(file, encoding, callback, stream);
    });
  };

  return that.constructor(options);
};

module.exports = $.gulpShopifyDelayedUpload;
