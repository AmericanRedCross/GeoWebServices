
/**
 * Module dependencies.
 */
var pg = require('pg');

var express = require('express')
  , routes = require('./routes')
  , user = require('./routes/user')
  , http = require('http')
  , path = require('path')
  , flow = require('flow')
  , rest = require('./custom_modules/getJSON')
  , settings = require('./settings')
  , loggly = require('loggly');

var app = express();
var routes = [];

//PostGres Connection String
var conString = "postgres://" + settings.pg.username + ":" + settings.pg.password + "@" + settings.pg.server + ":" + settings.pg.port + "/" + settings.pg.database;

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
app.use("/public/html_test", express.static(path.join(__dirname, 'public/html_test')));
app.use(function (err, req, res, next) {
    console.error(err.stack);
    log(err.message);
    res.send(500, 'There was an error with the web servcie. Please try your operation again.');
    log('There was an error with the web servcie. Please try your operation again.');
});


// development only
if ('development' == app.get('env')) {
    app.use(express.errorHandler());
}

//Define Routes

//List available operations
routes['listServices'] = function (req, res) {

    //object with available services
    var opslist = [
                   { link: 'nameSearch', name: 'Name search' },
                   { link: 'getAdminStack', name: 'Get Administrative Levels' }
                  ];

    //send to view
    res.render('services', { baseURL: req.url, title: 'RedCross GeoWebServices', opslist: opslist, breadcrumbs: [{ link: "/services", name: "Home" }] })

};

//Show page interface for Admin 0 List
routes['admin0list'] = function (req, res) {

};

//Show Test Page
routes['showTestPage'] = flow.define(
    function (req, res) {
        this.req = req;
        this.res = res;

        //See if there is any data being POSTed
        if (JSON.stringify(req.body) != '{}') {

        }
        else {
            //If no arguments in the POST, render default page.
            //Send to view
            res.render('admin_test_page', { baseURL: req.url })
        }


    }
);


//Name search is a method that will accept a searchterm and return 0 to many results.  It will NOT return admin levels for the matched term.
//It will simply list possible matches for the search term.  
routes['nameSearch'] = flow.define(

    function (req, res) {
        this.req = req;
        this.res = res;

        // arguments passed to routes['adminNameSearch'] will pass through to this first function
        if (JSON.stringify(req.body) != '{}') {
            //Get the text arg, pass it to function
            //udf_executeadminsearchbyname
            this.searchterm = "";
            if (this.req.body.searchterm) {
                this.searchterm = this.req.body.searchterm;
            }
            else {
                var errorMessage = "You must specify a search term.";
                this.res.render('admin_namesearch', { title: 'GeoWebServices', errorMessage: errorMessage, infoMessage: this.req.params.infoMessage, searchterm: this.req.body.searchterm, format: this.req.body.format, breadcrumbs: [{ link: "/services", name: "Home" }, { link: "", name: "Query" }] })
                return;
            }


            //Try querying internal GeoDB - strict (exact match) first
            executeAdminNameSearch(this.searchterm, { strict: true }, this);

        }
        else {
            //If the querystring is empty, just show the regular HTML form.
            //Render Query Form without any results.
            this.res.render('admin_namesearch', { title: 'GeoWebServices', breadcrumbs: [{ link: "/services", name: "Home" }, { link: "", name: "Admin Query by Name" }] })
        }
    }, function (result) {
        //this is the result of executeAdminNameSearch 'strict' callback
        //result should be sucess or error.  If success, return results to user.
        //if error or no results, try the non-strict results

        if (result && result.status == "success") {
            if (result.rows.length > 0) {
                //Return results
                //Check which format was specified
                if (!this.req.body.format || this.req.body.format == "html") {
                    var formatted = JSONFormatter(result.rows); //The page will parse the geoJson to make the HTMl
                    //Render HTML page with results at bottom
                    this.res.render('admin_namesearch', { title: 'GeoWebServices', errorMessage: this.req.params.errorMessage, infoMessage: this.req.params.infoMessage, featureCollection: formatted, format: this.req.body.format, searchterm: this.req.body.searchterm, breadcrumbs: [{ link: "/services", name: "Home" }, { link: "", name: "Query" }] })
                }
                else if (this.req.body.format && this.req.body.format == "JSON") {
                    //Respond with JSON
                    var formatted = JSONFormatter(result.rows);
                    this.res.header("Content-Type:", "application/json");
                    this.res.json(JSON.stringify(formatted)); //This allows for JSONP requests.
                }
                return;
            }
            else {
                //no matches from GeoDb in strict mode
                //Try querying internal GeoDB - not strict
                executeAdminNameSearch(this.searchterm, { strict: false }, this);
            }
        }
        else if (result && result.status == "error") {
            //Try querying internal GeoDB - not strict
            executeAdminNameSearch(this.searchterm, { strict: false }, this);
        }
        else {
            //Try querying internal GeoDB - not strict
            executeAdminNameSearch(this.searchterm, { strict: false }, this);
        }
    }, function (result) {
        //this is the result of executeAdminNameSearch 'not-strict' callback
        //result should be sucess or error.  If success, return results to user.
        //if error or no results, try GeoNames

        if (result && result.status == "success") {
            if (result.rows.length > 0) {
                //Return results
                //Check which format was specified
                if (!this.req.body.format || this.req.body.format == "html") {
                    var formatted = JSONFormatter(result.rows); //The page will parse the geoJson to make the HTMl
                    //Render HTML page with results at bottom
                    this.res.render('admin_namesearch', { title: 'GeoWebServices', errorMessage: this.req.params.errorMessage, infoMessage: this.req.params.infoMessage, featureCollection: formatted, format: this.req.body.format, searchterm: this.req.body.searchterm, breadcrumbs: [{ link: "/services", name: "Home" }, { link: "", name: "Query" }] })
                }
                else if (this.req.body.format && this.req.body.format == "JSON") {
                    //Respond with JSON
                    var formatted = JSONFormatter(result.rows);
                    this.res.header("Content-Type:", "application/json");
                    this.res.json(JSON.stringify(formatted)); //This allows for JSONP requests.
                }
                return;
            }
            else {
                //no matches from GeoDb
                //Check GeoNames
                executeGeoNamesAPISearch(this.searchterm, this)
            }
        }
        else if (result && result.status == "error") {
            //Check GeoNames
            executeGeoNamesAPISearch(this.searchterm, this)
        }
        else {
            //Check GeoNames
            executeGeoNamesAPISearch(this.searchterm, this)
        }
    },
    function (statuscode, result) {
        //This is the callback from the GeoNamesAPI Search
        //check the result and decide what to do.
        if (statuscode && statuscode == "200") {
            //we got a response, decide what to do
            if (result && result.geonames && result.geonames.length > 0) {
                var formatted = JSONFormatter(result.geonames); //format as JSON
                if (!this.req.body.format || this.req.body.format == "html") {
                    //Render HTML page with results at bottom
                    this.res.render('admin_namesearch', { title: 'GeoWebServices', errorMessage: this.req.params.errorMessage, infoMessage: this.req.params.infoMessage, featureCollection: formatted, format: this.req.body.format, searchterm: this.req.body.searchterm, breadcrumbs: [{ link: "/services", name: "Home" }, { link: "", name: "Query" }] })
                }
                else if (this.req.body.format && this.req.body.format == "JSON") {
                    //Respond with JSON
                    this.res.header("Content-Type:", "application/json");
                    this.res.json(JSON.stringify(formatted)); //This allows for JSONP requests.
                }
            }
            else {
                //no results
                var infoMessage = "No results found.";
                this.res.render('admin_namesearch', { title: 'GeoWebServices', errorMessage: this.req.params.errorMessage, infoMessage: infoMessage, featureCollection: formatted, format: this.req.body.format, searchterm: this.req.body.searchterm, breadcrumbs: [{ link: "/services", name: "Home" }, { link: "", name: "Query" }] })
            }
        } else {
            //handle it
            var errorMessage = "Unable to complete operation. Response code: " + statuscode;
            this.res.render('admin_namesearch', { title: 'GeoWebServices', errorMessage: errorMessage, infoMessage: this.req.params.infoMessage, featureCollection: formatted, format: this.req.body.format, searchterm: this.req.body.searchterm, breadcrumbs: [{ link: "/services", name: "Home" }, { link: "", name: "Query" }] })
        }
    }
);

routes['getAdminStack'] = flow.define(

    function (req, res) {
        this.req = req;
        this.res = res;

        if (JSON.stringify(req.body) != '{}') {
            //Get the text arg, pass it to function

            this.uniqueid = "";
            this.adminlevel = -1;
            this.datasource = "";
            this.wkt = "";

            if (this.req.body.uniqueid) {
                this.uniqueid = this.req.body.uniqueid;
            }
            if (this.req.body.adminlevel) {
                this.adminlevel = this.req.body.adminlevel;
            }
            if (this.req.body.datasource) {
                this.datasource = this.req.body.datasource;
            }
            if (this.req.body.wkt) {
                this.wkt = this.req.body.wkt;
            }

            //Set up an object to hold search terms
            var searchObj = {};

            //All 3 need to be defined OR WKT.
            if (this.uniqueid && this.adminlevel && this.datasource) {
                //Run the search
                searchObj.uniqueid = this.uniqueid;
                searchObj.adminlevel = this.adminlevel;
                searchObj.datasource = this.datasource;
                searchObj.isSpatial = false;
            }
            else {
                if (this.wkt && this.datasource) {
                    //Use the geometry to search
                    searchObj.wkt = this.wkt;
                    searchObj.datasource = this.datasource; //optional
                    searchObj.adminlevel = this.adminlevel; //optional
                    searchObj.isSpatial = true;
                }
                else {
                    var errorMessage = "Please provide either a boundary's uniqueID, level and datasource, OR provide a WKT point and datasource.";
                    this.res.render('get_admin_stack', { title: 'GeoWebServices', errorMessage: errorMessage, infoMessage: this.req.params.infoMessage, format: this.req.body.format, wkt: this.req.body.wkt, uniqueid: this.req.body.uniqueid, adminlevel:this.req.body.adminlevel, datasource: this.req.body.format, breadcrumbs: [{ link: "/services", name: "Home" }, { link: "", name: "Get Admin Stack" }] })
                    return;
                }
            }
            
            //Try querying internal GeoDB
            executeAdminStackSearch(searchObj, this);

        }
        else {
            //If the querystring is empty, just show the regular HTML form.
            //Render Query Form without any results.
            this.res.render('get_admin_stack', { title: 'GeoWebServices', breadcrumbs: [{ link: "/services", name: "Home" }, { link: "", name: "Get Admin Stack" }] })
        }
    }, function (result) {
        //The result of execute Admin Stack Search
        //successful search
        if (result.status == "success") {
            var formatted = JSONFormatter(result.rows); //format as JSON
            if (!this.req.body.format || this.req.body.format == "html") {
                //Render HTML page with results at bottom
                this.res.render('get_admin_stack', { title: 'GeoWebServices', errorMessage: this.req.params.errorMessage, infoMessage: this.req.params.infoMessage, featureCollection: formatted, wkt: this.req.body.wkt, uniqueid: this.req.body.uniqueid, adminlevel: this.req.body.adminlevel, format: this.req.body.format, datasource: this.req.body.datasource, breadcrumbs: [{ link: "/services", name: "Home" }, { link: "", name: "Query" }] })
            }
            else if (this.req.body.format && this.req.body.format == "JSON") {
                //Respond with JSON
                this.res.header("Content-Type:", "application/json");
                this.res.json(JSON.stringify(formatted)); //This allows for JSONP requests.
            }
        }
        else if (result.status == "error") {
            log(result.message.text);
            this.res.render('get_admin_stack', { title: 'GeoWebServices', errorMessage: "error: " + result.message.text, infoMessage: this.req.params.infoMessage, featureCollection: formatted, wkt: this.req.body.wkt, uniqueid: this.req.body.uniqueid, adminlevel: this.req.body.adminlevel, format: this.req.body.format, datasource: this.req.body.datasource, breadcrumbs: [{ link: "/services", name: "Home" }, { link: "", name: "Query" }] })
        }
        
    }
);


//Get list of public base tables from postgres
routes['listTables'] = function (req, res) {

    try {
        var client = new pg.Client(conString);
        client.connect();

        var sql = "SELECT * FROM information_schema.tables WHERE table_schema = 'public' and table_type = 'BASE TABLE' ORDER BY table_schema,table_name;"

        var query = client.query(sql);

        var table_list = [];
        query.on('row', function (row) {
            table_list.push({ table_name: row.table_name });
        });

        query.on('end', function () {
            res.render('index', { baseURL: req.url, title: 'pGIS Server', list: table_list, breadcrumbs: [{ link: "/services", name: "Home" }] })
            client.end();
        });
    } catch (e) {
        res.end("out");
    }
};

//List properties of the selected table, along with operations.
routes['tableDetail'] = function (req, res) {

    var client = new pg.Client(conString);
    client.connect();

    var sql = "select column_name, CASE when data_type = 'USER-DEFINED' THEN udt_name ELSE data_type end as data_type from INFORMATION_SCHEMA.COLUMNS where table_name = '" + req.params.table + "'";

    var query = client.query(sql);

    var table_list = [];
    query.on('row', function (row) {
        table_list.push(row);
    });

    query.on('end', function () {
        res.render('table_details', { baseURL: req.url, title: 'pGIS Server', table_details: table_list, breadcrumbs: [{ link: "/services", name: "Home" }, { link: "", name: req.params.table }] })
        client.end();
    });
};





//A route to handle an error.  Pass in req, res, and the view you'd like to write to.
routes['onError'] = function (req, res, view, message) {
    if (view == "table_query") {
        res.render('table_query', { title: 'pGIS Server', infoMessage: message, format: req.body.format, where: req.body.where, groupby: req.body.groupby, statsdef: req.body.statsdef, returnfields: req.body.returnfields, returnGeometry: req.body.returnGeometry, breadcrumbs: [{ link: "/services", name: "Home" }, { link: "/services/" + req.params.table, name: req.params.table }, { link: "", name: "Query" }] })
    }
    else if (view == "print") {
        res.render('print', { errorMessage: message, format: req.body.format, url: req.body.url, delay: req.body.delay, selector: req.body.selector, codeblock: req.body.codeblock, breadcrumbs: [{ link: "/services", name: "Home" }, { link: "", name: "Print" }] })
    }
};




//Define Routes
//Root Request - redirect to services page
app.get('/', function (req, res) { res.redirect('/services') });

//List All Services
app.get('/services', routes['listServices']);

//Admin Name Query - get - display page with default form
app.get('/services/nameSearch', routes['nameSearch']);

//When a Query gets posted - read attributes from post and render results
app.post('/services/nameSearch', routes['nameSearch']);

//Admin Stack Query - get - display page with default form
app.get('/services/getAdminStack', routes['getAdminStack']);

//When a Query gets posted - read attributes from post and render results
app.post('/services/getAdminStack', routes['getAdminStack']);

//List Tables
app.get('/services/list', routes['listTables']);

//Table Detail
app.get('/services/list/:table', routes['tableDetail']);

//Test UI page for SalesForce Integration
app.get('/admin_test_page', routes['showTestPage']);

//Test UI page for SalesForce Integration
app.post('/admin_test_page', routes['showTestPage']);




//Start listening
http.createServer(app).listen(app.get('port'), app.get('ipaddr'), function () {
    log('Express server listening on port ' + app.get('port'));
});


//Functions
//pass in a search term, check the Geodatabase for matching names
//This is part 1 of 2 for getting back an admin stack
function executeAdminNameSearch(searchterm, options, callback) {

    var sql = "";
    if (options) {
        if (options.strict == true) {
            //Try for exact match
            sql = "select * from udf_executestrictadminsearchbyname('" + searchterm + "')";
        }
        else {
            //use wildcard or partial match
            sql = "select * from udf_executeadminsearchbyname('" + searchterm + "')";
        }
    }
    else {
        //use wildcard or partial match
        sql = "select * from udf_executeadminsearchbyname('" + searchterm + "')";
    }

    //run it
    executePgQuery(sql, callback);
}

//pass in a search object with uniqueid, admin level, datasource OR WKT, find the matching administrative hierarchy
function executeAdminStackSearch(searchObject, callback) {
    var sql = "";

    //See if this is a spatial (WKT) search or not
    if (searchObject.isSpatial == false) {
        //lookup by id, datasource and level
        //build sql query
        sql = buildAdminStackQuery(searchObject.uniqueid, searchObject.datasource, searchObject.adminlevel);
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
            adminLevel = dsLevels[searchObject.datasource.toLowerCase()];
        }

        //Admin level will be passed in iteratively until we find a match.
        function hitTest(level) {
            if (level >= 0) {
                //Do Hit Test, starting with lowest available admin level
                log("In hit test loop.  checking level " + level);
                sql = buildAdminStackSpatialQuery(searchObject.wkt, searchObject.datasource, level);
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
                        hitTest(level-1);
                    }
                });
            }
        }
        //initiate loop
        hitTest(adminLevel);
    }
}

function executePgQuery(query, callback) {
    var result = { status: "success", rows: [] }; //object to store results, and whether or not we encountered an error.

    //Just run the query
    //Setup Connection to PG
    var client = new pg.Client(conString);
    client.connect();

    //Log the query to the console, for debugging
    console.log("Executing query: " + query);
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


function JSONFormatter(rows) {
    //Take in results object, return JSON

    //Loop thru results
    var featureCollection = { "type": "FeatureCollection", "features": [] };

    rows.forEach(function (row) {
        var feature = { "type": "Feature", "properties": {} };
        feature.properties = row;
        featureCollection.features.push(feature);
    })

    return featureCollection;
}

//The lowest level for each datasource
var dsLevels = {};
dsLevels["gadm"] = 5;
dsLevels["gaul"] = 2;
dsLevels["naturalearth"] = 1;
dsLevels["local"] = 2;

//Columns by level and datasource
var dsColumns = {};

dsColumns["gadm0"] = "ogc_fid, id_0, name_0";
dsColumns["gadm1"] = "ogc_fid, id_0, name_0, id_1, name_1";
dsColumns["gadm2"] = "ogc_fid, id_0, name_0, id_1, name_1, id_2, name_2";
dsColumns["gadm3"] = "ogc_fid, id_0, name_0, id_1, name_1, id_2, name_2, id_3, name_3";
dsColumns["gadm4"] = "ogc_fid, id_0, name_0, id_1, name_1, id_2, name_2, id_3, name_3, id_4, name_4";
dsColumns["gadm5"] = "ogc_fid, id_0, name_0, id_1, name_1, id_2, name_2, id_3, name_3, id_4, name_4, id_5, name_5";

dsColumns["gaul0"] = "ogc_fid, adm0_code, adm0_name";
dsColumns["gaul1"] = "ogc_fid, adm0_code, adm0_name, adm1_code, adm1_name";
dsColumns["gaul2"] = "ogc_fid, adm0_code, adm0_name, adm1_code, adm1_name, adm2_code, adm2_name";

//TODO
dsColumns["naturalearth0"] = "ogc_fid, adm0_code, adm0_name";
dsColumns["naturalearth1"] = "ogc_fid, adm0_code, adm0_name, adm1_code, adm1_name";

//TODO
dsColumns["local0"] = "ogc_fid, adm0_code, adm0_name";
dsColumns["local1"] = "ogc_fid, adm0_code, adm0_name, adm1_code, adm1_name";

function buildAdminStackQuery(rowid, datasource, level) {
    //build up the query to be executed
    var query = "";
    var table = "";
    switch (datasource.toLowerCase()) {
        case "gadm":
            table = "gadm" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ogc_fid = " + rowid;
            break;

        case "gaul":
            table = "gaul" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ogc_fid = " + rowid;
            break;

        case "naturalearth":
            table = "naturalearth" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ogc_fid = " + rowid;
            break;

        case "local":
            table = "local" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE where ogc_fid = " + rowid;
            break;
    }

    return query;
}

function buildAdminStackSpatialQuery(wkt, datasource, level) {
    //build the spatial query
    var query = "";
    var table = "";

    switch (datasource.toLowerCase()) {
        case "gadm":
            table = "gadm" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ST_Intersects(ST_GeomFromText('" + wkt + "', 4326), geom)";
            break;

        case "gaul":
            table = "gaul" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ST_Intersects(ST_GeomFromText('" + wkt + "', 4326), geom)";
            break;

        case "naturalearth":
            table = "naturalearth" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ST_Intersects(ST_GeomFromText('" + wkt + "', 4326), geom)";
            break;

        case "local":
            table = "local" + level;
            query = "SELECT " + dsColumns[table] + " FROM " + table + " WHERE ST_Intersects(ST_GeomFromText('" + wkt + "', 4326), geom)";
            break;
    }

    return query;
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
