/**
 * Welcome to Cloudflare Workers! This is your first scheduled worker.
 *
 * - Run `wrangler dev --local` in your terminal to start a development server
 * - Run `curl "http://localhost:8787/cdn-cgi/mf/scheduled"` to trigger the scheduled event
 * - Go back to the console to see what your worker has logged
 * - Update the Cron trigger in wrangler.toml (see https://developers.cloudflare.com/workers/wrangler/configuration/#triggers)
 * - Run `wrangler publish --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/runtime-apis/scheduled-event/
 */

import GtfsRealtimeBindings from "gtfs-realtime-bindings";

export default {
	async scheduled(controller, env, ctx) {
		let vehicles = {};
		let stations = {};
		let parentStations = {};

		console.log('Starting update for BART');

		console.log('Fetching data from BART real time API');
		const trackingResponse = await fetch('https://api.bart.gov/gtfsrt/tripupdate.aspx');
		const trackingBuffer = await trackingResponse.arrayBuffer();

		console.log('Fetching route data from Piemadd GTFS API');
		const gtfsRoutesResponse = await fetch('https://gtfs.piemadd.com/data/bart/routes.json');
		const gtfsRoutes = await gtfsRoutesResponse.json();

		console.log('Fetching station data from Piemadd GTFS API');
		const gtfsStationsResponse = await fetch('https://gtfs.piemadd.com/data/bart/stops.json');
		const gtfsStations = await gtfsStationsResponse.json();

		console.log('Parsing data from BART real time API');
		const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
			new Uint8Array(trackingBuffer)
		);

		console.log('Filling in station data');
		Object.values(gtfsStations).forEach((station) => {
			stations[station.stopID] = {
				stationID: station.stopID,
				name: station.stopName,
				latitude: station.stopLat,
				longitude: station.stopLon,
				parent: station.parentStation.replace('place_', '') || station.stopID.replace('place_', ''),
				upcomingTrains: [],
			};
		})

		//console.log(feed.entity)

		console.log('Updating BART tracking data');
		feed.entity.forEach((entity, i) => {
			let routeID = '';
			Object.values(gtfsRoutes).forEach((route) => {
				if (route.routeTrips.includes(Number(entity.tripUpdate.trip.tripId))) {
					routeID = route.routeID;
				};
			});

			if (routeID === '') return;

			vehicles[entity.tripUpdate.trip.tripId] = {
				routeID: routeID,
				tripID: entity.tripUpdate.trip.tripId,
				routeShortName: gtfsRoutes[routeID].routeShortName.split('-')[0],
				routeLongName: gtfsRoutes[routeID].routeLongName,
				routeColor: gtfsRoutes[routeID].routeColor,
				routeTextColor: gtfsRoutes[routeID].routeTextColor,
				stops: entity.tripUpdate.stopTimeUpdate.map((stop) => {
					return {
						stopID: stop.stopId,
						stopSequence: stop.stopSequence,
						arr: stop.arrival.time,
						dep: stop.departure.time,
						delay: stop.departure.delay,
						untilArrival: Math.floor((new Date().valueOf() - (stop.departure.time.low * 1000))/1000),
					}
				}),
			}

			vehicles[entity.tripUpdate.trip.tripId].stops.forEach((stop) => {
				if (stations[stop.stopID]) {
					stations[stop.stopID].upcomingTrains.push({
						routeID: vehicles[entity.tripUpdate.trip.tripId].routeID,
						tripID: vehicles[entity.tripUpdate.trip.tripId].tripID,
						routeShortName: vehicles[entity.tripUpdate.trip.tripId].routeShortName,
						routeLongName: vehicles[entity.tripUpdate.trip.tripId].routeLongName,
						routeColor: vehicles[entity.tripUpdate.trip.tripId].routeColor,
						routeTextColor: vehicles[entity.tripUpdate.trip.tripId].routeTextColor,
						arr: stop.arr,
						dep: stop.dep,
						delay: stop.delay,
						untilArrival: stop.untilArrival,
					});
				}
			})
		});

		console.log('Moving data to parent stations')
		Object.values(stations).forEach((station) => {
			if (!parentStations[station.parent]) {
				parentStations[station.parent] = {
					stationID: station.parent,
					name: station.name,
					latitude: station.latitude,
					longitude: station.longitude,
					upcomingTrains: [],
				}
			}

			parentStations[station.parent].upcomingTrains = parentStations[station.parent].upcomingTrains.concat(station.upcomingTrains);
		})

		//console.log(parentStations)

		fetch(`https://macro.railstat.us/api/update?path=v1/bart`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Auth-Token': env.TOKEN,
			},
			body: JSON.stringify({
				vehicles: vehicles,
				stations: parentStations,
			}),
		})
		.then((response) => response.text())
		.then((data) => {
			console.log('Success:', data);
		})
		.catch((error) => {
			console.error('Error:', error);
		});
	},
};
