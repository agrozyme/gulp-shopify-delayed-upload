'use strict';

var $ = {
  async: require('asyncawait/async'),
  await: require('asyncawait/await'),
  promise: require('bluebird'),
  through: require('through2'),
  gulpUtil: require('gulp-util'),
  inquirer: require('inquirer'),
  path: require('path'),
  open: require('open'),
  shopify: require('shopify-api-node')
};

$.shopifyUpload = function(options) {
  if (false === this instanceof $.shopifyUpload) {
    return new $.shopifyUpload(options);
  }

  var that = this;
  var prototype = $.shopifyUpload.prototype;
  var self = {};

  const pluginName = 'gulp-shopify-delayed-updateAsset';

  self.options = {
    key: '', pass: '', name: '', themeid: '', basePath: '', host: '', preview: ''
  };

  self.last = 0;

  /** @prop {$.shopify} that.api */
  self.api = false;

  prototype.constructor = function(options) {
    var that = this;
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
    items.preview = 'http://' + items.host + '?preview_theme_id=' + items.themeid;
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

    var action = that.getApi().asset.update(self.options.themeid, data.asset).then(function(data) {
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

    var action = that.getApi().asset.delete(self.options.themeid, data).then(function(data) {
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
      colors.magenta(options.themeid) +
      colors.gray(' theme name: ') +
      colors.magenta(options.themename));

    items.push(colors.gray('Browser to: ') +
      colors.magenta('http://' + options.host + '?preview_theme_id=' + options.themeid));

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

    if (themes.hasOwnProperty(options.themeid)) {
      options.themename = themes[options.themeid].name;
    } else {
      var data = $.await(that.selectTheme(themes));
      options.themeid = data.id;
      options.themename = data.name;
    }

    that.setOptions(options);
    that.validateOptions();
    that.showConnectionMessage();
  });

  prototype.validateUploadFile = function(file) {
    var that = this;
    var options = self.options;
    var colors = $.gulpUtil.colors;

    if (file.isStream()) {
      that.log('Streams are not supported!', colors.red);
      // this.emit('error', new $.gulpUtil.PluginError(pluginName, 'Streams are not supported!'));
      return false;
    }

    if ((null === options.themeid) || (-1 !== file.path.indexOf('.DS_Store'))) {
      return false;
    }

    return true;
  };

  prototype.uploadFile = function(file, encoding, callback) {
    var that = this;

    if (false === that.validateUploadFile(file)) {
      callback();
      return;
    }

    if (file.isBuffer()) {
      that.updateAsset(file).then(function() {
        callback();
      });
    }

    if (file.isNull()) {
      that.deleteAsset(file).then(function() {
        callback();
      });
    }
  };

  prototype.streamUpload = function() {
    var that = this;

    // that.prepareUpload().then(function(data) {
    //   console.log(data);
    // });

    return $.through.obj(function(file, encoding, callback) {
      var item = this;

      that.uploadFile(file, encoding, function() {
        item.push(file);
        callback();
      });
    });
  };

  return that.constructor(options);
};

module.exports = $.shopifyUpload;
