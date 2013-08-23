Querying Red Cross GeoServices
==============================

### Overview ###

The ECOS project of the American Red Cross (ARC) will establish a central system for tracking and reporting on the organization's global projects and activities. Projects and activities will be tagged with their location, including all levels of administrative boundaries and geographic coordinates (latitude and longitude) if available. This will enable spatial queries and spatial reporting and mapping, such as the number of programs by district. 

To support location tagging, ARC is developing a set of Geo Web Services to allow for searching and retrieval of an entire hierarchy of administrative boundaries from a variety of global administrative datasets including GADM, GAUL, NaturalEarth, and GeoNames. In addition, custom Red Cross boundaries (regional chapter boundaries for example) and local administrative boundaries will be available if requested.

These Geo Web Services are being developed specifically to support the placename search feature of the ARC ECOS project tracking tool, though additional endpoints and functionality may be added in the future.

### Sample Use Scenario ### 

An ARC staff member is recording a new activity into ECOS. The activity location is Port-au-Prince, Haiti. The staff member opens a browser, logs into ECOS, and creates a new activity record. The staff member proceeds through the necessary steps to enter all of the project information though the web form. Included in the web form is a location field. A link next to the location field opens a new window which prompts the submission of a placename.

The staff member types Port-au-Prince and hits enter. Three possible matches are returned. Two matches from the GADM dataset, and one match from the GAUL dataset.  The staff member chooses one of the matches and clicks OK to close the window and return to the ECOS project information entry screen. The activity may then be saved and submitted with the selected location tag.

Service Endpoints
-----------------

There are currently two main web service REST endpoints located on the development server [http://54.213.94.50/services](http://54.213.94.50/services)

1. Name Search: [http://54.213.94.50/services/nameSearch](http://54.213.94.50/services/nameSearch)

2. Get Admin Stack: [http://54.213.94.50/services/getAdminStack](http://54.213.94.50/services/getAdminStack)

__Note:__ There is also a search page that will be called from ECOS that will allow the user to do the placename search and send the results back to ECOS.  This page is located at [http://54.213.94.50/search](http://54.213.94.50/search).


### Name Search ###

#### Description ####

The Name Search endpoint is a RESTful web service that can accept GET and POST requests.  It also supports JSONP response format.

The NameSearch web service searches the ARC Admin Boundary database in the following manner:

1.	An exact match search is run against all internal datasources.   If an exact match is found, then a result is returned. If no exact match is found:

2.	A ‘loose’ search is run against all internal datasources.  For example, the searchterm ‘King’ might return King County, Washington and Kingston, Jamaica and any other admin boundary starting with the word King.  If no loose match is found:

3.	The searchterm is sent to the [Geonames](http://www.geonames.org/) API.  Geonames will usually find a result, which will then be returned.

#### Parameters ####

- **searchterm** _(text)_: The placename to search for.  Should not include commas.  Does not search for addresses or fully qualified city/state/country strings.

- **featureid** _(integer)_: If you have the featureID of a particular admin boundary, you can use it to look up a feature.  If ‘searchterm’ is specified, then featureid is ignored.

- **format** _(string)_: Options are html or GeoJSON.  HTML will simply return a search form with results at the bottom.  Used for manual querying or testing.

- **returnGeometry** _(string)_: Options are yes or no. Specifies whether the service should return the coordinates of the admin polygon.


#### Sample JSONP Call (jQuery 2.0.3) ####

```javascript
var postArgs = {
	searchterm: "dallas",
	format: "GeoJSON",
	returnGeometry: "yes"
};

var url = 'http://54.213.94.50/services/nameSearch';

//Send POST, using JSONP
$.getJSON(url + "?callback=?", postArgs).done(function (data) {
	handleNameSearchResponse(data);
}).fail(function (jqxhr, textStatus, error) {
	var err = textStatus + ', ' + error;
	console.log("Request Failed: " + err);
});
```

#### Sample Results ####

The GeoJSON or JSON result from this service will have one of two structures. The strucure will depend on whether a match was found from the internal GeoDB, or if a match was found from the GeoNames API.

An example of a JSON result from an internal GeoDB match is:

```json
{
	"type": "FeatureCollection",
	"features": [
		{
			"type": "Feature",
			"properties": {
				"stackid": "1815",
				"featureid": "296949",
				"name": "Colima",
				"level": "1",
				"source": "GADM",
				"country": "Mexico",
				"year": "2012",
				"fullname": "Colima, Mexico"
			}
		}
	],
	"source": "GeoDB"
}
```

An example of a JSON result from the Geonames API is:

```json
{
	"type": "FeatureCollection",
	"features": [
		{
			"type": "Feature",
			"properties": {
				"countryId": "6252001",
				"adminCode1": "WA",
				"countryName": "United States",
				"fclName": "city, village,...",
				"countryCode": "US",
				"lng": "-122.43457",
				"fcodeName": "populated place",
				"toponymName": "Spanaway",
				"fcl": "P",
				"name": "Spanaway",
				"fcode": "PPL",
				"geonameId": 5811581,
				"lat": "47.10399",
				"adminName1": "Washington",
				"population": 27227				
			}
		}
	],
	"source": "Geonames"
}
```

Assuming one of the two results was returned, a second call can be made to the GetAdminStack web service to actually retrieve the full hierarchy of administrative boundaries for the location returned from this web service.

### Get Admin Stack ###

#### Description ####

The GetAdminStack endpoint is a RESTful web service that can accept GET and POST requests.  It also supports JSONP response format.  There are three ways to query this service:

1.	By FeatureID
2.	By StackID, level and datasource
3.	By X,Y and datasource

#### Parameters ####

- **featureid** _(integer)_: If the featureID is available from the NameSearch web service, it can be used by itself to retrieve the full administrative boundary stack.

- **stackid** _(integer)_: StackID is available as a property of the NameSearch web service.  It can be used in conjunction with the level and datasource input parameters to retrieve a particular admin stack.

- **adminlevel** _(integer)_: The level corresponding to the stackid and datasource. 

- **datasource** _(string)_: The raw dataset from which the stack originated. Options are GAUL, GADM and NaturalEarth.

- **format** _(string)_: Options are html or GeoJSON.  HTML will simply return a search form with results at the bottom.  Used for manual querying or testing.

- **wkt** _(string)_: A Well Known Text representation of a feature.  Could be any valid geometry including point, line, polygon or multipoint. Example: POINT(85.341 25.811) (X,Y)

#### Sample JSONP Call (jQuery 2.0.3) ####

```javascript
var postArgs = {
	featureid: 544785,
	format: "GeoJSON"	
};

var url = 'http://54.213.94.50/services/getAdminStack';

//Send POST, using JSONP
$.getJSON(url + "?callback=?", postArgs).done(function (data) {
	handleAdminStackResponse(data);
}).fail(function (jqxhr, textStatus, error) {
	var err = textStatus + ', ' + error;
	console.log("Request Failed: " + err);
});
```

#### Sample Results ####

The structure of a JSON result will depend on how ‘deep’ the administrative stack is. The number of admin levels for a result will depend on the datasource. An example of a JSON result with admin levels 0 through 5 is:

```json
{
	"type": "FeatureCollection",
	"features": [
		{
			"type": "Feature",
			"properties": {
				"id": 37549,
				"adm0_code": 118,
				"adm0_name": "Kenya",
				"adm1_code": 3,
				"adm1_name": "Eastern",
				"adm2_code": 13,
				"adm2_name": "Embu",
				"adm3_code": 59,
				"adm3_name": "Gachoka",
				"adm4_code": 246,
				"adm4_name": "Embu Municipality",
				"adm5_code": 922,
				"adm5_name": "Dallas/Stadium",
			}
		}
	]
}
```