'use strict';

const AWS = require("aws-sdk");
//AWS.config.loadFromPath('./config.json');
const SES = new AWS.SES({region: 'us-east-1'});
const Crawler = require('crawler');
const async = require('async');
const StringBuilder = require('stringbuilder');

const Datastore = require('nedb')
    , db = new Datastore({filename: '/tmp/swappa.db', autoload: true});
//, db = new Datastore();

db.loadDatabase(function (err) {
    if (err)
        console.error(err);
});


function crawlSwappa(cb) {
    let previousItems = [];
    db.find({}, function (err, docs) {
        for (var i in docs) {
            previousItems.push(docs[i]);
        }
    });

    let items = [];

    let crawler = new Crawler({
        maxConnections: 10,
        rateLimit: 10
    });

    crawler.on('drain', function () {
        console.log('Draining, found', items.length, 'items.');
        //var sb = new StringBuilder({newline: '\r\n'});

        let soldItems = [];
        let newItems = [];
        let priceDrops = [];

        async.eachSeries(items, function (item, cb) {

            db.findOne({_id: item.itemNumber}, function (err, doc) {
                if (err)
                    console.error(err);
                if (doc) {
                    if (doc.price > item.price) {
                        priceDrops.push(item);
                        //sb.appendLine('Price drop ({0}->{1}) on item {2}, {3}.', doc.price, item.price, item.itemNumber, item.bucket);
                        item.oldPrice = doc.price;
                    }

                    db.update({_id: item.itemNumber}, item, {}, function (err) {
                        if (err)
                            console.error(err);
                        cb();
                    });
                } else {
                    newItems.push(item);
                    // New item
                    //sb.appendLine('New item:\t{0}\t{1}\t{2}\{3}', item.bucket, item.price, item.description, item.itemNumber);
                    item._id = item.itemNumber;

                    db.insert(item, function (err, newDoc) {
                        if (err)
                            console.error(err);
                        cb();
                    });
                }
            });
        }, function (err) {
            console.log('Looking for sold items');
            if (err)
                console.error(err);
            async.eachSeries(previousItems, function (item, cb) {
                var match = items.filter((e) => e.itemNumber == item._id);

                if (!match || match.length == 0) {
                    soldItems.push(item);
                    db.remove({_id: item._id}, {}, function (err, numRemoved) {
                        if (err)
                            console.error(err);
                        cb();
                    });
                } else
                    cb();
            }, function () {
                console.log('Done with historic updates.');

                cb(newItems, priceDrops, soldItems, items);
            });
        });
    });

    retrieveProductLinks(crawler, 'https://swappa.com/buy/devices/tablets?search=pro&platform=ios');


    function retrieveProductLinks(crawler, entryPoint) {
        crawler.queue({
            uri: entryPoint,
            jQuery: true,
            callback: function (error, res, done) {

                var linkArray = [];
                if (error) {
                    console.log(error);
                } else {
                    var $ = res.$;

                    var links = $("section.section_main > div.row.dev_grid > div.col-md-2.col-sm-3.col-xs-4 > div > div.title > a");


                    links.each(function (index) {
                        linkArray.push($(this).attr('href'));
                    });

                }

                async.eachSeries(linkArray, function iteratee(link, linkCallback) {
                    console.log(link);
                    crawler.queue({
                        uri: 'https://swappa.com' + link,
                        jQuery: true,
                        callback: function (error, res, done1) {
                            console.log('Downloaded', link);

                            var $ = res.$;

                            let productDescription = $('#breadcrumbs > div > ul > li.active.hidden-xs').text().toLowerCase();

                            var products = $("div.listing_preview_wrapper > div > div.inner > div.media > div.media-body ");

                            products.each(function (index) {
                                let price = $(this).find("div.row > div.col-xs-2.col-md-2 > a.price").text().trim().replace('$', '');
                                let description = $(this).find('div.more_area > div.headline > a').text().trim();
                                let itemNumber = $(this).find('div.more_area > div.headline > a').attr('href').trim().replace('/listing/', '').replace('/buy/stock/', '').replace('/view', '');
                                let capacity = $(this).find("div.row > div.col-xs-2.col-md-2 > span.storage").text().replace(' GB', '').trim();
                                let connectivity = 'wifi';
                                if (productDescription.indexOf('verizon') > -1 || productDescription.indexOf('unlocked') > -1 || productDescription.indexOf('at&amp;t') > -1 || productDescription.indexOf('t-mobile') > -1) {
                                    connectivity = 'cell';
                                }
                                let screenSize = '';
                                if (productDescription.indexOf('9.7') > -1) {
                                    screenSize = '9.7';
                                }
                                if (productDescription.indexOf('10.5') > -1) {
                                    screenSize = '10.5';
                                }
                                if (productDescription.indexOf('12.9') > -1) {
                                    screenSize = '12.9';
                                }

                                items.push({
                                    bucket: screenSize + '-' + capacity + '-' + connectivity,
                                    capacity: parseInt(capacity),
                                    connectivity: connectivity,
                                    description: description,
                                    price: parseFloat(price),
                                    screenSize: screenSize,
                                    itemNumber: itemNumber
                                });
                            });

                            done1();

                        }
                    });
                    linkCallback();
                }, function () {
                    console.log('Done requesting pages.');
                    done();
                });
            }
        });
    }
}

function capture(callback) {
    crawlSwappa(function (newItems, priceDrops, soldItems, items) {
        console.log('Done crawling.');
        var sb = new StringBuilder( {newline:'\r\n'} );

        let sendMail = false;
        if (newItems.length>0) {
            sendMail = true;
            sb.appendLine();
            sb.appendLine('New Items:');
            newItems.sort((a, b) => a.price - b.price);
            for (var i in newItems) {
                sb.appendLine('{0}\t{1}\t{2}\t{3}', newItems[i].bucket, newItems[i].price, newItems[i].description, newItems[i].itemNumber);
            }
        }

        if (priceDrops.length>0) {
            sendMail = true;
            sb.appendLine();
            sb.appendLine('Price Drops:');
            priceDrops.sort((a, b) => a.price - b.price);
            for (var i in priceDrops) {
                sb.appendLine('{0}\t{1}->{2}\t{3}\t{4}', priceDrops[i].bucket, priceDrops[i].oldPrice, priceDrops[i].price, priceDrops[i].description, priceDrops[i].itemNumber);
            }
        }

        if (soldItems.length>0) {
            sendMail = true;
            sb.appendLine();
            sb.appendLine('Sold Items:');
            soldItems.sort((a, b) => a.price - b.price);
            for (var i in soldItems) {
                sb.appendLine('{0}\t{1}\t{2}\t{3}', soldItems[i].bucket, soldItems[i].price, soldItems[i].description, soldItems[i].itemNumber);
            }
        }
        if (sendMail) {
            items.sort((a, b) => a.price - b.price);
            let counter = [];
            sb.appendLine('');
            sb.appendLine('Lowest priced items:');
            for (var i in items) {
                if (items[i].capacity > 0) {
                    if (!counter[items[i].bucket])
                        counter[items[i].bucket] = 0;

                    if (counter[items[i].bucket] < 5) {
                        sb.appendLine('{0}\t{1}\t{2}\t{3}', items[i].bucket, items[i].price, items[i].description, items[i].itemNumber);

                        counter[items[i].bucket] = counter[items[i].bucket] + 1;
                    }
                }
            }
            sb.build(function (err, result) {
                console.log(result);

                SES.sendEmail({
                    Destination: {
                        ToAddresses: ['alex.lokshin@2zick.com']
                    },
                    Message: {
                        Body: {
                            Text: {
                                Charset: "UTF-8",
                                Data: result
                            }
                        },
                        Subject: {
                            Charset: "UTF-8",
                            Data: "Swappa iPad Pro report"
                        }
                    },
                    Source: "alex.lokshin@2zick.com"
                }, (err, data) => {
                    if (err)
                        console.error(err);
                    console.log(data);
                    console.log('Done. Done.');
                    callback(err);
                });
            });
        } else {
            console.log('Nothing to report.');
            callback(null);
        }
    });
}


module.exports.capture = (event, context, callback) => {
    capture(function (err) {
        var body = {};

        body.payload = {version: '1.0.1', status: 'OK', err: err};
        var response = {
            statusCode: 200,
            body: JSON.stringify(body)
        };
        callback(err, response);
    });
};
