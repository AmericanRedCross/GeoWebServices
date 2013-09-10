
/**
 * Module dependencies.
 */
var pg = require('pg');

var express = require('express')
  , routes = require('./routes')
  , user = require('./routes/user')
  , http = require('http')
  , url = require('url')
  , path = require('path')
  , flow = require('flow')
  , rest = require('./custom_modules/getJSON')
  , settings = require('./settings')
  , loggly = require('loggly')
  , httpProxy = require('http-proxy')
  , ga = require('nodealytics')
  , fs = require('fs')
  , https = require('https');

var app = express();

//Array to hold functions for routes
var routes = [];

//PostGres Connection String
var conString = "postgres://" + settings.pg.username + ":" + settings.pg.password + "@" + settings.pg.server + ":" + settings.pg.port + "/" + settings.pg.database;

//Init Proxy
var proxy = new httpProxy.RoutingProxy(settings.proxyOptions);

//Configure Loggly (logging API)
var config = {
    subdomain: settings.loggly.subdomain,
    auth: {
        username: settings.loggly.username,
        password: settings.loggly.password
    }
};

//Loggly client
var logclient = loggly.createClient(config);

//Google Analytics
ga.initialize(settings.ga.key, '54.213.94.50', function () {
});

//Configure HTTPS
var SSLoptions = {
    pfx: fs.readFileSync(settings.ssl.pfx),
    passphrase: settings.ssl.password
};

// all environments
app.set('port', process.env.PORT || settings.application.port);
app.set('views', __dirname + '/views'); 
app.set('view engine', 'jade');
app.enable("jsonp callback");
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.methodOverride());
app.use(express.cookieParser('your secret here'));
app.use(express.session());
app.use(app.router);
app.use(require('less-middleware')({ src: __dirname + '/public' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use("/public/javascript", express.static(path.join(__dirname, 'public/javascript')));
app.use("/public/images", express.static(path.join(__dirname, 'public/images')));


app.use(function (err, req, res, next) {
    console.error(err.stack);
    log(err.message);
    res.send(500, 'There was an error with the web service. Please try your operation again.');
    log('There was an error with the web servcice. Please try your operation again.');
});


// development only
if ('development' == app.get('env')) {
    app.use(express.errorHandler());
}

//Define Routes
//List available operations - default screen
routes['listServices'] = function (req, res) {

    //object with available services
    var opslist = [
                   { link: 'nameSearch', name: 'Name search' },
                   { link: 'getAdminStack', name: 'Get Admin Stack' }
                  ];

    //send to view
    res.render('services', { baseURL: req.url, title: 'RedCross GeoWebServices', opslist: opslist, breadcrumbs: [{ link: "/services", name: "Home" }] })

};

//handles requests to the proxy
routes['proxyRequest'] = function (req, res) {
    //Holds the arguments passed
    var args = {};

    //Grab POST or QueryString args depending on type
    if (req.method.toLowerCase() == "post") {
        //If a post, then arguments will be members of the this.req.body property
        args = req.body;
    }
    else if (req.method.toLowerCase() == "get") {
        //If request is a get, then args will be members of the this.req.query property
        args = req.query;
    }

    if (args.returnUrl) {
        //Get the returnUrl parameter and parse it.
        //Assumes returnUrl is a fully qualified URL - http://www.foo.com
        var urlObj = url.parse(args.returnUrl);

        //Check the white list of allowed domains
        var hostArray = urlObj.host.split("."); //break up url domain by periods
        var domain = hostArray.slice(-2, hostArray.length).join("."); //put together the last 2 elements, so we get foo.com

        //check the domain against the white list.
        if (settings.proxyOptions.allowedDomains.indexOf(domain) > -1) {
            //Domain is OK.
            //update the reqest headers.
            req.headers.host = urlObj.host;
            req.url = urlObj.path;

            log("Requested Host in Proxy: " + urlObj.host);

            //Make the request
            proxy.proxyRequest(req, res, {
                host: urlObj.host,
                port: urlObj.port || 80,
                enable: { xforward: true }
            });
        }
        else {
            //Domain is not ok.
            res.send(500, 'The domain - ' + domain + ' - is not allowed by the proxy.');
            log('The domain - ' + domain + ' - is not allowed by the proxy.');
        }
    }
    else {
        //No return URL specified
        //Domain is not ok.
        res.send(500, 'Proxy got no arguments');
        log('Proxy got no arguments');
    }
};


//Name search is a method that will accept a searchterm and return 0 to many results.  It will NOT return admin levels for the matched term.
//It will simply list possible matches for the search term.  
routes['nameSearch'] = function (req, res) {
    var args = {};

    //Grab POST or QueryString args depending on type
    if (req.method.toLowerCase() == "post") {
        //If a post, then arguments will be members of the this.req.body property
        args = req.body;
    }
    else if (req.method.toLowerCase() == "get") {
        //If request is a get, then args will be members of the this.req.query property
        args = req.query;
    }

    //Google Analytics
    ga.trackPage('NameSearch', '/services/nameSearch', function (err, resp) {
        if (!err && resp.statusCode === 200) {
            console.log('Page has been tracked with Google Analytics');
        }
    });

    //Detect if args were passed in
    if (JSON.stringify(args) != '{}') {
        //Add custom properties as defaults
        args.view = "admin_namesearch"
        args.featureCollection = { source: "GeoDB" };

        //Get the text arg, pass it to function
        var searchterm = "", featureid = "";
        if (args.searchterm) {
            //User is doing a text search
            searchterm = args.searchterm;
            //Try querying internal GeoDB - strict (exact match) first
            startExecuteAdminNameSearch(searchterm, { type: "name", strict: true, returnGeometry: args.returnGeometry }, req, res, args);
            GATrackEvent("Get Feature", "by name", args.searchterm); //Analytics

        }
        else if (args.featureid) {
            //User is searching by unique ID from text_search table
            featureid = args.featureid;
            //Try querying internal GeoDB using feature id
            executeAdminIDSearch(featureid, { type: "id", returnGeometry: args.returnGeometry }, function (result) {
                //handle results of id search
                args.featureCollection = geoJSONFormatter(result.rows); //The page will parse the geoJson to make the HTMl
                args.featureCollection.source = "GeoDB";
                args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Query" }];
                respond(req, res, args);
                return;
            });
            GATrackEvent("Get Feature", "by Id", args.featureid); //Analytics

        }
        else {
            //No search term, abort.
            args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Query" }];
            args.errorMessage = 'You must specify a search term or feature id.';
            respond(req, res, args);
            return;
        }
    }
    else {
        //If no arguments are provided, just show the regular HTML form.
        args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Admin Query by Name" }];
        args.view = "admin_namesearch";
        respond(req, res, args);
    }
}

routes['getAdminStack'] = flow.define(
    function (req, res) {
        //Stash the node request and response objects.
        this.req = req;
        this.res = res;

        //Grab POST or QueryString args depending on type
        if (this.req.method.toLowerCase() == "post") {
            //If a post, then arguments will be members of the this.req.body property
            this.args = this.req.body;
        }
        else if (this.req.method.toLowerCase() == "get") {
            //If request is a get, then args will be members of the this.req.query property
            this.args = this.req.query;
        }

        //Google Analytics
        ga.trackPage('GetAdminStack', '/services/getAdminStack', function (err, resp) {
            if (!err && resp.statusCode === 200) {
                console.log('Page has been tracked with Google Analytics');
            }
        });

        //Detect if args were passed in
        if (JSON.stringify(this.args) != '{}') {
            //Add custom properties as defaults
            this.args.view = "get_admin_stack";
            this.args.title = "GeoWebServices";
            this.args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Get Admin Stack" }];

            //Set up an object to hold search terms
            var searchObj = {};
            searchObj.returnGeometry = this.args.returnGeometry;

            //All 3 need to be defined OR WKT & Datasource and Level, or feature ID.
            if (this.args.featureid) {
                //If we get the feature id, we need to first look up the item from textsearch table, and then go  get the stack.
                executeAdminStackSearchByFeatureId(this.args.featureid, this.req, this.res, this.args); //It has its own flow defined
                GATrackEvent("Get Admin Stack", "by feature id", this.args.featureid); //Analytics
                return;
            }
            else if (this.args.stackid && this.args.adminlevel && this.args.datasource) {
                //Check to see if the datasource was valid
                if (settings.dsColumns[this.args.datasource.toLowerCase() + this.args.adminlevel]) {
                    //Set up search parameters
                    searchObj.stackid = this.args.stackid;
                    searchObj.adminlevel = this.args.adminlevel;
                    searchObj.datasource = this.args.datasource;
                    searchObj.isSpatial = false;

                    GATrackEvent("Get Admin Stack", "by Stack ID, Admin, Datasource",  this.args.stackid + "," + this.args.adminlevel + "," + this.args.datasource); //Analytics
                }
                else {
                    //Couldn't find this datasource in the settings file. Exit.
                    this.args.errorMessage = this.args.datasource.toLowerCase() + this.args.adminlevel + " was not found. Try GADM0, GAUL1 or NaturalEarth0, for example";
                    this.args.featureCollection = { message: this.args.errorMessage, type: "FeatureCollection", features: [] };

                    //Render HTML page with results at bottom
                    respond(this.req, this.res, this.args);
                    return;
                }
            }
            else {
                //did they pass in GEOM And Datasource and Level?
                if (this.args.wkt && this.args.datasource) {
                    //Check to see if the datasource was valid
                    if (settings.dsColumns[this.args.datasource.toLowerCase() + (this.args.adminlevel ? this.args.adminlevel : "0")]) {
                        //Use the geometry in search parameters
                        searchObj.wkt = this.args.wkt;
                        searchObj.datasource = this.args.datasource; //optional
                        searchObj.adminlevel = this.args.adminlevel; //optional
                        searchObj.isSpatial = true;

                        GATrackEvent("Get Admin Stack", "by Geom, Admin, Datasource", this.args.wkt + "," + this.args.adminlevel + "," + this.args.datasource); //Analytics

                    } else {
                        //Couldn't find this datasource in the settings file. Exit.
                        this.args.errorMessage = this.args.datasource.toLowerCase() + (this.args.adminlevel ? this.args.adminlevel : "0") + " was not found. Try GADM0, GAUL1 or NaturalEarth0, for example";
                        this.args.featureCollection = { message: this.args.errorMessage, type: "FeatureCollection", features: [] };

                        //Render HTML page with results at bottom
                        respond(this.req, this.res, this.args);
                        return;
                    }

                }
                else {
                    //Let 'em know, then abort
                    this.args.errorMessage = "Please provide either a boundary's stack ID, level and datasource, OR provide a WKT point and datasource.";
                    this.args.featureCollection = { message: this.args.errorMessage, type: "FeatureCollection", features: [] }; //The page will parse the geoJson to make the HTMl

                    //Render HTML page with results at bottom
                    respond(this.req, this.res, this.args);
                    return;
                }
            }


            //Try querying internal GeoDB
            executeAdminStackSearch(searchObj, this);
        }
        else {
            //If the querystring is empty, just show the regular HTML form.
            //Render Query Form without any results.
            this.args.view = "get_admin_stack";
            this.args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Get Admin Stack" }];
            this.args.title = "GeoWebServices";

            respond(this.req, this.res, this.args);
        }
    }, function (result) {
        //The result of execute Admin Stack Search
        //successful search
        if (result.status == "success") {
            this.args.featureCollection = geoJSONFormatter(result.rows); //format as JSON
            respond(this.req, this.res, this.args);
        }
        else if (result.status == "error") {
            log(result.message.text);
            this.args.errorMessage = "error: " + result.message.text;
            respond(this.req, this.res, this.args);
        }
        
    }
);

//Reroute HTTP requests to HTTPS
//app.all('*', function (req, res, next) {
//    console.log("got request");
//    if (req.headers['x-forwarded-proto'] != 'https')
//        res.redirect('https://' + req.headers.host + req.url)
//    else
//        next() /* Continue to other routes if we're not redirecting */
//})

//Define Routes
//Root Request - redirect to services page
app.get('/', function (req, res) { res.redirect('/services') });

//List All Services
app.get('/services', routes['listServices']);

//Admin Name Query - get - display page with default form
app.all('/services/nameSearch', routes['nameSearch']);

//Admin Stack Query - get - display page with default form
app.all('/services/getAdminStack', routes['getAdminStack']);

//Route search path to static search html file
app.get('/search', function (req, res) {
    res.sendfile(__dirname + '/public/search/search.html');
});

//Proxy for cross domain calls
app.all('/proxy', routes['proxyRequest']);


//Start listening
https.createServer(SSLoptions, app).listen(app.get('port'), app.get('ipaddr'), function () {
    log('Express server listening on port ' + app.get('port'));
});


//Functions
//pass in a search term, check the Geodatabase for matching names
//This is part 1 of 2 for getting back an admin stack
var startExecuteAdminNameSearch = flow.define(

    function (searchterm, options, req, res, args) {
        this.req = req;
        this.res = res;
        this.args = args;

        //Start looking for exact matches
        executeStrictAdminNameSearch(this.args.searchterm, { returnGeometry: this.args.returnGeometry }, this);

    }, function (result) {
        //this is the result of executeAdminNameSearch 'strict' callback
        //result should be sucess or error.  If success, return results to user.
        //if error or no results, try the non-strict results

        log("strict matches for " + this.args.searchterm + ": " + result.rows.length);

        if (result && result.status == "success" && result.rows.length > 0) {

            this.args.featureCollection = geoJSONFormatter(result.rows); //The page will parse the geoJson to make the HTMl
            this.args.featureCollection.source = "GeoDB";
            this.args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Query" }];
            respond(this.req, this.res, this.args);
            return;
        }
        else {
            //Try querying internal GeoDB - not strict
            executeLooseAdminNameSearch(this.args.searchterm, { returnGeometry: this.args.returnGeometry }, this);
        }
    }, function (result) {
        //this is the result of executeAdminNameSearch 'not-strict' callback
        //result should be sucess or error.  If success, return results to user.
        //if error or no results, try GeoNames

        log("loose matches for " + this.args.searchterm + ": " + result.rows.length);

        if (result && result.status == "success" && result.rows.length > 0) {

            //Return results
            //Check which format was specified

            this.args.featureCollection = geoJSONFormatter(result.rows); //The page will parse the geoJson to make the HTMl
            this.args.featureCollection.source = "GeoDB";
            this.args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Query" }];

            //Render HTML page with results at bottom
            respond(this.req, this.res, this.args);
            return;
        }
        else {
            //Check GeoNames
            executeGeoNamesAPISearch(this.args.searchterm, this)
        }
    },
    function (statuscode, result) {
        //This is the callback from the GeoNamesAPI Search
        //check the result and decide what to do.

        this.args.breadcrumbs = [{ link: "/services", name: "Home" }, { link: "", name: "Query" }];

        if (statuscode && statuscode == "200") {
            //we got a response, decide what to do
            if (result && result.geonames && result.geonames.length > 0) {

                this.args.featureCollection = geoJSONFormatter(result.geonames); //The page will parse the geoJson to make the HTMl
                this.args.featureCollection.source = "Geonames";

                //Render HTML page with results at bottom
                respond(this.req, this.res, this.args);
            }
            else {
                //no results
                var infoMessage = "No results found.";
                this.args.infoMessage = infoMessage;
                this.args.featureCollection = { message: infoMessage, type: "FeatureCollection", features: [] }; //The page will parse the geoJson to make the HTMl
                this.args.featureCollection.source = "Geonames";

                //Render HTML page with results at bottom
                respond(this.req, this.res, this.args);
            }
        } else {
            //handle a non 200 response
            this.args.errorMessage = "Unable to complete operation. Response code: " + statuscode;
            this.args.featureCollection = { message: this.args.errorMessage, type: "FeatureCollection", features: [] }; //The page will parse the geoJson to make the HTMl

            //Render HTML page with results at bottom
            respond(this.req, this.res, this.args);
        }
    }
);



//Strict name Search
function executeStrictAdminNameSearch(searchterm, options, callback) {

    var sql = { text: "select * from udf_executestrictadminsearchbyname($1)", values: [searchterm] };

    if (options) {
        if (options.returnGeometry == "yes") {
            //Try for exact match - with geom
            sql = { text: "select * from udf_executestrictadminsearchbynamewithgeom($1)", values: [searchterm] };
        }
        else {
            //Try for exact match - without geom
            sql = { text: "select * from udf_executestrictadminsearchbyname($1)", values: [searchterm] };
        }
        //run it
        executePgQuery(sql, callback);
    }
}

//loose name search
function executeLooseAdminNameSearch(searchterm, options, callback) {

    var sql = { text: "select * from udf_executeadminsearchbyname($1)", values: [searchterm] };

    if (options) {
        if (options.returnGeometry == "yes") {
            //use wildcard or partial match - with geom
            sql = { text: "select * from udf_executeadminsearchbynamewithgeom($1)", values: [searchterm] };
        }
        else {
            //use wildcard or partial match - without geom
            sql = { text: "select * from udf_executeadminsearchbyname($1)", values: [searchterm] };
        }
    }


    //run it
    executePgQuery(sql, callback);
}

//pass in an ID, check the text search table for the ID
//This is part 1 of 2 for getting back an admin stack
function executeAdminIDSearch(featureID, options, callback) {

    //search by ID - without geom
    var sql = { text: "select * from udf_executeadminsearchbyid($1)", values: [featureID] }; //default

    if (options) {
        if (options.returnGeometry == "yes") {
            //search by ID - with geom
            sql = { text: "select * from udf_executeadminsearchbyidwithgeom($1)", values: [featureID] };
        }
    }

    //run it
    executePgQuery(sql, callback);
}




//pass in a search object with stackid, admin level, datasource OR WKT, find the matching administrative hierarchy
function executeAdminStackSearch(searchObject, callback) {
    var sql = "";

    //See if this is a spatial (WKT) search or not
    if (searchObject.isSpatial == false) {
        //lookup by id, datasource and level
        //build sql query
        sql = buildAdminStackQuery(searchObject.stackid, searchObject.datasource, searchObject.adminlevel, searchObject.returnGeometry);
        log(sql);

        //run it
        executePgQuery(sql, callback);
    }
    else {
        //do a spatial search

        //If user specifies admin level, then use that to start with, otherwise, start with the lowest level for that datasource
        var adminLevel = 2;

        if (searchObject.adminlevel) {
            //use user's level
            adminLevel = searchObject.adminlevel;
        }
        else {
            //use a specified level
            adminLevel = settings.dsLevels[searchObject.datasource.toLowerCase()];
        }

        log(adminLevel);

        //Admin level will be passed in iteratively until we find a match.
        function hitTest(level) {
            if (level >= 0) {
                //Do Hit Test, starting with lowest available admin level
                log("In hit test loop.  checking level " + level);
                sql = buildAdminStackSpatialQuery(searchObject.wkt, searchObject.datasource, level, searchObject.returnGeometry);
                executePgQuery(sql, function (result) {
                    if (result.status == "success") {
                        //we found a match, break out.
                        if (result.rows.length > 0) {
                            callback(result);
                            return;
                        }
                        else {
                            //continue searching
                            hitTest(level - 1);
                        }
                    }
                    else {
                        //continue searching
                        hitTest(level - 1);
                    }
                });
            }
            else {
                //We've hit the end of the road
                log("checked all levels for " + searchObject.wkt + ", found nothing.");
                callback({ rows: [], status: "success" });
            }
        }
        //initiate loop
        hitTest(adminLevel);
    }
}

//This is the case where user passes in feature id to the admin stack search. in this case, we need to look up the level and datasource for that feature, and then build a query to get the stack.
var executeAdminStackSearchByFeatureId = flow.define(

    function (featureid, req, res, args) {
        this.req = req;
        this.res = res;
        this.args = args;

        executeAdminIDSearch(featureid, { type: "id", returnGeometry: this.args.returnGeometry }, this);

    },
    function (result) {
        //handle results of executeAdminIDSearch
        if (result && result.rows) {
            //If we got a result from text_search table, then build a query to get the stack.
            var row = result.rows[0];
            var searchObj = {};
            searchObj.stackid = row.stackid;
            searchObj.adminlevel = row.level;
            searchObj.datasource = row.source;
            searchObj.returnGeometry = this.args.returnGeometry;
            searchObj.isSpatial = false;

            executeAdminStackSearch(searchObj, this);
        }
    },
    function (result) {
        //handles results of executeAdminStackSearch
        //The result of execute Admin Stack Search
        //successful search
        if (result.status == "success") {
            this.args.featureCollection = geoJSONFormatter(result.rows); //format as JSON
            respond(this.req, this.res, this.args);
        }
        else if (result.status == "error") {
            log(result.message.text);
            this.args.errorMessage = "error: " + result.message.text;
            respond(this.req, this.res, this.args);
        }
    }
)

//query is a JSON object with 2 properties: text and values.
//Example
//    var query = {
//        text: 'SELECT name FROM users WHERE email = $1',
//        values: ['brian@example.com']
//};
function executePgQuery(query, callback) {
    var result = { status: "success", rows: [] }; //object to store results, and whether or not we encountered an error.

    //Just run the query
    //Setup Connection to PG
    var client = new pg.Client(conString);
    client.connect();

    //Log the query to the console, for debugging
    console.log("Executing query: " + query.text + ", " + query.values);
    var query = client.query(query);

    //If query was successful, this is iterating thru result rows.
    query.on('row', function (row) {
        result.rows.push(row);
    });

    //Handle query error - fires before end event
    query.on('error', function (error) {
        //req.params.errorMessage = error;
        result.status = "error";
        result.message = error;
    });

    //end is called whether successfull or if error was called.
    query.on('end', function () {
        //End PG connection
        client.end();
        callback(result); //pass back result to calling function
    });
}



//pass in a search term, check the Geonames API for matching names
function executeGeoNamesAPISearch(searchterm, callback) {
    //Reach out to GeoNames API

    //Encode for URL
    searchterm = encodeURIComponent(searchterm);

    var options = {
        host: 'api.geonames.org',
        path: '/search?name=' + searchterm + '&username=' + settings.geonames.username + '&featureClass=A&featureClass=P&type=json',
        method: 'GET',
        port: 80,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    rest.getJSON(options, function (statusCode, result) {
        log("got geonames result.");
        callback(statusCode, result)
    }); //send result back to calling function
}

////Take in results object, return GeoJSON (if there is geometry)
function geoJSONFormatter(rows, geom_fields_array) {
    //Take in results object, return GeoJSON
    if (!geom_fields_array) geom_fields_array = ["geom"]; //default

    //Loop thru results
    var featureCollection = { "type": "FeatureCollection", "features": [] };

    rows.forEach(function (row) {
        var feature = { "type": "Feature", "properties": {} };
        //Depending on whether or not there is geometry properties, handle it.  If multiple geoms, use a GeometryCollection output for GeoJSON.
        if (geom_fields_array && geom_fields_array.length == 1) {
            //single geometry
            if (row[geom_fields_array[0]]) {
                feature.geometry = JSON.parse(row[geom_fields_array[0]]);
                //remove the geometry property from the row object so we're just left with non-spatial properties
                delete row[geom_fields_array[0]];
            }
        }
        else if (geom_fields_array && geom_fields_array.length > 1) {
            //if more than 1 geom, make a geomcollection property
            feature.geometry = { "type": "GeometryCollection", "geometries": [] };
            geom_fields_array.forEach(function (item) {
                feature.geometry.geometries.push(row[item]);
                //remove the geometry property from the row object so we're just left with non-spatial properties
                delete row[item];
            });
        }

        //handle centroids
        if (row.centroid) {
            row.centroid = row.centroid.replace("POINT(", "").replace(")", "").split(" "); //split WKT into a coordinate array [x,y]
        }

        feature.properties = row;
        featureCollection.features.push(feature);
    })

    return featureCollection;
}



function buildAdminStackQuery(rowid, datasource, level, returnGeometry) {
    //build up the query to be executed for getting Admin Stacks
    
    var table = datasource.toLowerCase() + level; //gadm, gaul, naturalearth, local, custom
    var queryObj = {};
    try{
        queryObj.text = "SELECT " + (returnGeometry == "yes" ? settings.dsColumns[table].geometry : "") + settings.dsColumns[table].columns + " FROM " + table + " WHERE guid = $1";
        queryObj.values = [rowid];
    } catch (e) {

    }
    finally{
        return queryObj;
    }

    
}

function buildAdminStackSpatialQuery(wkt, datasource, level, returnGeometry) {
    //build the spatial query for getting Admin Stacks by WKT geometry intersect
    var table = datasource.toLowerCase() + level; //gadm, gaul, naturalearth, local, custom
    var queryObj = {};

    queryObj.text = "SELECT " + (returnGeometry == "yes" ? settings.dsColumns[table].geometry : "") + settings.dsColumns[table].columns + " FROM " + table + " WHERE ST_Intersects(ST_GeomFromText($1, 4326), geom)";
    queryObj.values = [wkt];

    return queryObj;
}

function respond(req, res, args) {
    //Write out a response as JSON or HTML with the appropriate arguments.  Add more formats here if desired
    if (!args.format || args.format == "html") {
        res.render(args.view, args)
    }
    else if (args.format && args.format == "GeoJSON") {
        res.jsonp(args.featureCollection);
    }
}

//Utilities
function log(message) {
    //Write to console and to loggly
    logclient.log(settings.loggly.logglyKey, message);
    console.log(message);
}

//Determine if a string contains all numbers.
function IsNumeric(sText) {
    var ValidChars = "0123456789";
    var IsNumber = true;
    var Char;
    sText.replace(/\s+/g, '')

    for (i = 0; i < sText.length && IsNumber == true; i++) {
        Char = sText.charAt(i);
        if (ValidChars.indexOf(Char) == -1) {
            IsNumber = false;
        }
    }
    return IsNumber;
}

function GATrackEvent(category, action, label) {
    ga.trackEvent(category, action, label, function (err, resp) {
        if (!err && resp.statusCode === 200) {
            console.log('Event has been tracked with Google Analytics');
        }
    });
}

