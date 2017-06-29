'use strict';
const isLambda = !!(process.env.LAMBDA_TASK_ROOT || false);

const AWS = require("aws-sdk");
if (!isLambda) {
    AWS.config.loadFromPath('./config.json');
}
const SES = new AWS.SES({region: 'us-east-1'});
const Crawler = require('crawler');
const async = require('async');
const StringBuilder = require('stringbuilder');
const dynamo = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = 'swappa';
const IPAD_PRO_PREFIX = 'ipad-pro';
const MACBOOK_PREFIX = 'macbook';
const IPHONE_7_PLUS_PREFIX = 'iphone7plus';
const IPHONE_7_PREFIX = 'iphone7-';


function classify_ipad_pro(productDescription, capacity) {
    let connectivity = 'wifi';
    if (productDescription.indexOf('verizon') > -1 || productDescription.indexOf('unlocked') > -1 || productDescription.indexOf('at&amp;t') > -1 || productDescription.indexOf('t-mobile') > -1 || productDescription.indexOf('sprint') > -1) {
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
    return IPAD_PRO_PREFIX + '-' + screenSize + '-' + capacity + '-' + connectivity;
}

function classify_macbook_pro(productDescription, capacity) {

    let screensize = '';
    let year = '';
    let type = '';

    if (productDescription.indexOf('11"') > -1) {
        screensize = '11';
    }
    if (productDescription.indexOf('12"') > -1) {
        screensize = '12';
    }
    if (productDescription.indexOf('13"') > -1) {
        screensize = '13';
    }
    if (productDescription.indexOf('15"') > -1) {
        screensize = '15';
    }
    if (productDescription.indexOf('pro') > -1) {
        type = 'pro';
    }
    if (productDescription.indexOf('air') > -1) {
        type = 'air';
    }

    for (var i = 1999; i < 2100; i++) {
        if (productDescription.indexOf("" + i) > -1) {
            year = "" + i;
        }
    }


    return MACBOOK_PREFIX + '-' + type + '-' + year + '-' + screensize + '-' + capacity;
}

function classify_iphone_7_plus(productDescription, capacity) {

    let carrier = 'other';


    if (productDescription.indexOf('t-mobile') > -1) {
        carrier = 'tmobile';
    }

    if (productDescription.indexOf('verizon') > -1) {
        carrier = 'verizon';
    }

    if (productDescription.indexOf('unlocked') > -1) {
        carrier = 'unlocked';
    }

    if (productDescription.indexOf('at&amp;t') > -1 || productDescription.indexOf('at&t') > -1) {
        carrier = 'att';
    }

    if (productDescription.indexOf('sprint') > -1) {
        carrier = 'sprint';
    }

    return IPHONE_7_PLUS_PREFIX + '-' + carrier + '-' + capacity;
}

function classify_iphone_7(productDescription, capacity) {

    let carrier = 'other';


    if (productDescription.indexOf('t-mobile') > -1) {
        carrier = 'tmobile';
    }

    if (productDescription.indexOf('verizon') > -1) {
        carrier = 'verizon';
    }

    if (productDescription.indexOf('unlocked') > -1) {
        carrier = 'unlocked';
    }

    if (productDescription.indexOf('at&amp;t') > -1 || productDescription.indexOf('at&t') > -1) {
        carrier = 'att';
    }

    if (productDescription.indexOf('other') > -1) {
        carrier = 'other';
    }

    if (productDescription.indexOf('sprint') > -1) {
        carrier = 'sprint';
    }

    return IPHONE_7_PREFIX + '-' + carrier + '-' + capacity;
}

function crawlSwappa(prefix, classify, entryPoint, cb) {
    let previousItems = [];

    var params = {
        TableName: TABLE_NAME,
        ProjectionExpression: "itemNumber, price, description, item_bucket, active",
    };
    console.log('Loading previously indexed items...');
    dynamo.scan(params, function (err, data) {
        if (data && data.Items) {
            for (var i in data.Items) {
                if (data.Items[i].active == 1 && data.Items[i].item_bucket.indexOf(prefix) == 0) {
                    previousItems.push(data.Items[i]);
                }
            }
            console.log('Loaded', previousItems.length, 'previously indexed items.');
        } else {
            console.log('Did not load any previously indexed items: ', err);
        }
    });


    let items = [];

    let crawler = new Crawler({
        maxConnections: 10,
        rateLimit: 10
    });

    crawler.on('drain', function () {
        console.log('Draining, found', items.length, 'items.');

        let soldItems = [];
        let newItems = [];
        let priceDrops = [];
        let batchParams = [];

        async.eachSeries(items, function (item, cb) {
            var match = previousItems.filter((e) => e.itemNumber == item.itemNumber);
            var doc = null;
            if (match && match.length > 0)
                doc = match[0];

            if (doc) { // Updating existing record
                if (doc.price != item.price) {
                    if (doc.price > item.price && (doc.price - item.price) > doc.price * 0.05) {
                        priceDrops.push(item);
                        item.oldPrice = doc.price;
                    }
                    batchParams.push({
                        PutRequest: {
                            Item: {
                                'itemNumber': item.itemNumber,
                                'price': item.price,
                                'old_price': item.oldPrice,
                                'item_bucket': item.item_bucket,
                                'description': item.description,
                                'active': 1
                            }
                        }
                    });
                }


                cb();
            } else { // Inserting a new item
                newItems.push(item);
                batchParams.push({
                    PutRequest: {
                        Item: {
                            'itemNumber': item.itemNumber,
                            'price': item.price,
                            'old_price': item.oldPrice,
                            'item_bucket': item.item_bucket,
                            'description': item.description,
                            'active': 1
                        }
                    }
                });

                cb();
            }


        }, function (err) {

            if (err)
                console.error(err);

            console.log('Looking for sold items');
            async.eachSeries(previousItems, function (item, cb) {
                if (!items || items.length == 0)
                    cb();
                else {
                    var match = items.filter((e) => e.itemNumber == item.itemNumber);

                    if (!match || match.length == 0) {
                        soldItems.push(item);

                        batchParams.push({
                            PutRequest: {
                                Item: {
                                    'itemNumber': item.itemNumber,
                                    'price': item.price,
                                    'old_price': item.oldPrice,
                                    'item_bucket': item.item_bucket,
                                    'description': item.description,
                                    'active': 0
                                }
                            }
                        });

                        cb();
                    } else
                        cb();
                }
            }, function () {
                console.log('Found', batchParams.length, 'items to update.');
                var batches = [];
                while (batchParams.length > 0) {
                    batches.push(batchParams.splice(0, 25));
                }
                console.log('Split into ', batches.length, 'batches.');


                async.eachSeries(batches, function (batch, next) {

                    var params = {
                        RequestItems: {'swappa': batch}
                    };
                    dynamo.batchWrite(params, function (err, data) {
                        if (err) {
                            console.log('Error: ', err);
                            console.log('Request:', JSON.stringify(params));
                            console.log('Response:', JSON.stringify(data));
                        }

                        next(err);
                    });
                }, function (err) {
                    console.log('Done with historic updates.', err);

                    cb(newItems, priceDrops, soldItems, items);
                });
            });
        });
    });

    retrieveProductLinks(crawler, classify, entryPoint);

    function retrieveProductLinks(crawler, classify, entryPoint) {
        console.log('Entry point: ', entryPoint);
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

                    if (linkArray.length == 0) {
                        var links = $("section.section_more > div.row.dev_grid > div.col-md-2.col-sm-3.col-xs-4 > div > div.title > a");


                        links.each(function (index) {
                            linkArray.push($(this).attr('href'));
                        });
                    }

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

                                let bucket = classify(productDescription, capacity);

                                items.push({
                                    item_bucket: bucket,
                                    capacity: parseInt(capacity),
                                    description: description,
                                    price: parseFloat(price),
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

function capture(prefix, classify, entryPoint, callback) {
    crawlSwappa(prefix, classify, entryPoint, function (newItems, priceDrops, soldItems, items) {
        console.log('Done crawling.');
        var sb = new StringBuilder({newline: '\r\n'});
        sb.appendLine("<html><body>");

        let sendMail = false;
        if (newItems.length > 0) {
            sendMail = true;
            sb.appendLine();
            sb.appendLine('<h2>New Items:</h2>');
            sb.appendLine("<ul>");
            newItems.sort((a, b) => a.price - b.price);
            for (var i in newItems) {
                sb.appendLine('<li>{0}\t<b>{1}</b>\t{2}\t[<a href="http://www.swappa.com/listing/{3}/view">details</a>]</li>', newItems[i].item_bucket, newItems[i].price, newItems[i].description, newItems[i].itemNumber);
            }
            sb.appendLine("</ul>");
        }

        if (priceDrops.length > 0) {
            sendMail = true;
            sb.appendLine();
            sb.appendLine('<h2>Price Drops:</h2>');
            sb.appendLine("<ul>");
            priceDrops.sort((a, b) => a.price - b.price);
            for (var i in priceDrops) {
                sb.appendLine('<li>{0}\t<b>{1}->{2}</b>\t{3}\t[<a href="http://www.swappa.com/listing/{4}/view">details</a>]</li>', priceDrops[i].item_bucket, priceDrops[i].oldPrice, priceDrops[i].price, priceDrops[i].description, priceDrops[i].itemNumber);
            }
            sb.appendLine("</ul>");
        }

        if (newItems.length > 0 || priceDrops.length > 0) {
            if (soldItems.length > 0) {
                sendMail = true;
                sb.appendLine();
                sb.appendLine('<h2>Sold Items:</h2>');
                sb.appendLine("<ul>");
                soldItems.sort((a, b) => a.price - b.price);
                for (var i in soldItems) {
                    sb.appendLine('<li>{0}\t<b>{1}</b>\t{2}\t[<a href="http://www.swappa.com/listing/{3}/view">details</a>]</li>', soldItems[i].item_bucket, soldItems[i].price, soldItems[i].description, soldItems[i].itemNumber);
                }
                sb.appendLine("</ul>");
            }
        }

        if (sendMail) {
            items.sort((a, b) => a.price - b.price);
            let counter = [];
            sb.appendLine('');
            sb.appendLine('<h2>Lowest priced items:</h2>');
            sb.appendLine("<ul>");
            for (var i in items) {
                if (items[i].capacity > 0) {
                    if (!counter[items[i].item_bucket])
                        counter[items[i].item_bucket] = 0;

                    if (counter[items[i].item_bucket] < 5) {
                        sb.appendLine('<li>{0}\t<b>{1}</b>\t{2}\t[<a href="http://www.swappa.com/listing/{3}/view">details</a>]</li>', items[i].item_bucket, items[i].price, items[i].description, items[i].itemNumber);

                        counter[items[i].item_bucket] = counter[items[i].item_bucket] + 1;
                    }
                }
            }
            sb.appendLine("</body></html>");
            sb.build(function (err, result) {

                SES.sendEmail({
                    Destination: {
                        ToAddresses: ['alex.lokshin@2zick.com']
                    },
                    Message: {
                        Body: {
                            Html: {
                                Charset: "UTF-8",
                                Data: result
                            }
                        },
                        Subject: {
                            Charset: "UTF-8",
                            Data: "Swappa Report"
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

module.exports.capture_macbook = (event, context, callback) => {
    console.log('Capturing...');
    capture(MACBOOK_PREFIX, classify_macbook_pro, 'https://swappa.com/buy/devices/macbook', function (err) {
        console.log('Captured!');

        var body = {};

        body.payload = {version: '1.0.1', status: 'OK'};
        var response = {
            statusCode: 200,
            body: JSON.stringify(body)
        };
        callback(null, response);
    });
};


module.exports.capture_ipad_pro = (event, context, callback) => {
    console.log('Capturing...');
    capture(IPAD_PRO_PREFIX, classify_ipad_pro, 'https://swappa.com/buy/devices/tablets?search=pro&platform=ios', function (err) {
        console.log('Captured!');

        var body = {};

        body.payload = {version: '1.0.1', status: 'OK'};
        var response = {
            statusCode: 200,
            body: JSON.stringify(body)
        };
        callback(null, response);
    });
};

module.exports.capture_iphone_7_plus = (event, context, callback) => {
    console.log('Capturing...');
    capture(IPHONE_7_PLUS_PREFIX, classify_iphone_7_plus, 'https://swappa.com/buy/apple-iphone-7-plus', function (err) {
        console.log('Captured!');

        var body = {};

        body.payload = {version: '1.0.1', status: 'OK'};
        var response = {
            statusCode: 200,
            body: JSON.stringify(body)
        };
        callback(null, response);
    });
};

module.exports.capture_iphone_7 = (event, context, callback) => {
    console.log('Capturing...');
    capture(IPHONE_7_PREFIX, classify_iphone_7, 'https://swappa.com/buy/apple-iphone-7', function (err) {
        console.log('Captured!');

        var body = {};

        body.payload = {version: '1.0.1', status: 'OK'};
        var response = {
            statusCode: 200,
            body: JSON.stringify(body)
        };
        callback(null, response);
    });
};


if (!isLambda) {
    capture(IPAD_PRO_PREFIX, classify_ipad_pro, 'https://swappa.com/buy/devices/tablets?search=pro&platform=ios', function (err) {
        console.log('Done.');
    });

    capture(MACBOOK_PREFIX, classify_macbook_pro, 'https://swappa.com/buy/devices/macbook', function (err) {
        console.log('Done.');
    });

    capture(IPHONE_7_PLUS_PREFIX, classify_iphone_7_plus, 'https://swappa.com/buy/apple-iphone-7-plus', function (err) {
        console.log('Done.');
    });

    capture(IPHONE_7_PREFIX, classify_iphone_7, 'https://swappa.com/buy/apple-iphone-7', function (err) {
        console.log('Done.');
    });
}