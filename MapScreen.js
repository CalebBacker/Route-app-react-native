import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Button,
  Alert,
  TextInput,
  StyleSheet,
  SafeAreaView,
  useWindowDimensions,
  Switch
} from 'react-native';
import MapView, { Marker, Polyline, Callout } from 'react-native-maps';
import polyline from '@mapbox/polyline';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage key
const ROUTES_STORAGE_KEY = 'saved_routes';
// Google API Key
const GOOGLE_API_KEY = 'AIzaSyDc-ESEi6f0JZwOGXdOy_NVeVH1kfpS1UI';

function MapScreen({ navigation, route, loadRoutes }) {
  const [originQuery, setOriginQuery] = useState('');
  const [destinationQuery, setDestinationQuery] = useState('');
  const [routeCoords, setRouteCoords] = useState([]);
  const [showRestStops, setShowRestStops] = useState(false);
  const [restStops, setRestStops] = useState([]);
  const [isLoadingRestStops, setIsLoadingRestStops] = useState(false);
  const { width, height } = useWindowDimensions();
  const mapRef = useRef(null);

  // Find rest stops along the route - defined with useCallback
  const findRestStops = useCallback(async () => {
    if (routeCoords.length === 0) {
      Alert.alert('Error', 'Please generate a route first');
      setShowRestStops(false);
      return;
    }

    setIsLoadingRestStops(true);
    try {
      // We'll use several points along the route to search for rest stops
      const numPoints = Math.min(5, routeCoords.length);
      const step = Math.floor(routeCoords.length / numPoints);
      const searchPoints = [];
      
      for (let i = 0; i < numPoints; i++) {
        searchPoints.push(routeCoords[i * step]);
      }
      
      // Add destination point
      if (routeCoords.length > 0) {
        searchPoints.push(routeCoords[routeCoords.length - 1]);
      }

      // Set of unique place IDs to avoid duplicates
      const uniquePlaceIds = new Set();
      let allRestStops = [];

      // Search for rest stops near each point
      for (const point of searchPoints) {
        const { latitude, longitude } = point;
        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=16093&type=gas_station|restaurant|rest_area&key=${GOOGLE_API_KEY}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.status === 'OK' && data.results) {
          // Filter for unique places
          const newRestStops = data.results
            .filter(place => !uniquePlaceIds.has(place.place_id))
            .map(place => {
              uniquePlaceIds.add(place.place_id);
              return {
                id: place.place_id,
                name: place.name,
                location: {
                  latitude: place.geometry.location.lat,
                  longitude: place.geometry.location.lng
                },
                address: place.vicinity,
                types: place.types,
                rating: place.rating
              };
            });
          
          allRestStops = [...allRestStops, ...newRestStops];
        }
      }

      setRestStops(allRestStops);
    } catch (error) {
      console.error('Error finding rest stops:', error);
      Alert.alert('Error', 'Failed to find rest stops');
      setShowRestStops(false);
    } finally {
      setIsLoadingRestStops(false);
    }
  }, [routeCoords]);

  // Handle route selection from RoutesScreen
  useEffect(() => {
    const selected = route.params?.selectedRoute;
    if (selected) {
      setOriginQuery(selected.origin);
      setDestinationQuery(selected.destination);
      setRouteCoords(selected.route || []);
      
      // Fit map to selected route coordinates
      if (selected.route && selected.route.length > 0) {
        mapRef.current?.fitToCoordinates(selected.route, {
          edgePadding: { top: 50, bottom: 50, left: 50, right: 50 }
        });
      }
      
      // Clear params after processing
      navigation.setParams({ selectedRoute: undefined });
    }
  }, [route.params?.selectedRoute, navigation]);

  // Find rest stops when showRestStops is toggled or route changes
  useEffect(() => {
    if (showRestStops && routeCoords.length > 0) {
      findRestStops();
    } else {
      setRestStops([]);
    }
  }, [showRestStops, routeCoords, findRestStops]);

  // Get route from Google Maps API
  const getRoute = async () => {
    if (!originQuery.trim() || !destinationQuery.trim()) {
      Alert.alert('Error', 'Please enter both origin and destination.');
      return;
    }
    
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?key=${GOOGLE_API_KEY}&origin=${encodeURIComponent(originQuery)}&destination=${encodeURIComponent(destinationQuery)}`;
      
      const res = await fetch(url);
      const json = await res.json();
      
      if (json.status !== 'OK' || !json.routes.length) {
        Alert.alert('Error', 'Route not found.');
        return;
      }
      
      const points = polyline.decode(json.routes[0].overview_polyline.points);
      const coords = points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
      
      setRouteCoords(coords);
      
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 50, bottom: 50, left: 50, right: 50 }
      });

      // Reset rest stops when new route is fetched
      setRestStops([]);
      setShowRestStops(false);
    } catch (err) {
      console.warn('getRoute error:', err);
      Alert.alert('Error', 'Failed to fetch route.');
    }
  };

  // Save route to AsyncStorage
  const saveRoute = async () => {
    if (!originQuery.trim() || !destinationQuery.trim() || !routeCoords.length) {
      Alert.alert('Error', 'Please generate a route before saving.');
      return;
    }
    
    Alert.prompt(
      'Save Route',
      'Enter a name for this route:',
      async (name) => {
        if (!name?.trim()) {
          Alert.alert('Error', 'Route name cannot be empty.');
          return;
        }
        
        try {
          console.log('Starting route save...');
          
          // Create new route object
          const newRoute = {
            name: name.trim(),
            origin: originQuery,
            destination: destinationQuery,
            route: routeCoords
          };
          
          // Get current routes
          let routes = [];
          const storedRoutes = await AsyncStorage.getItem(ROUTES_STORAGE_KEY);
          console.log('Retrieved stored routes:', storedRoutes ? 'data found' : 'no data');
          
          if (storedRoutes) {
            routes = JSON.parse(storedRoutes);
          }
          
          // Check for duplicate names
          const duplicateIndex = routes.findIndex(r => r.name === name.trim());
          if (duplicateIndex >= 0) {
            Alert.alert(
              'Route name exists',
              'A route with this name already exists. Would you like to overwrite it?',
              [
                { text: 'Cancel', style: 'cancel' },
                { 
                  text: 'Overwrite', 
                  style: 'destructive', 
                  onPress: async () => {
                    routes[duplicateIndex] = newRoute;
                    await AsyncStorage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(routes));
                    Alert.alert('Success', 'Route updated!');
                    if (loadRoutes) loadRoutes();
                  }
                }
              ]
            );
            return;
          }
          
          // Add new route
          routes.push(newRoute);
          console.log('Saving routes array with', routes.length, 'items');
          
          // Save to AsyncStorage
          await AsyncStorage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(routes));
          Alert.alert('Success', 'Route saved!');
          if (loadRoutes) loadRoutes();
        } catch (err) {
          console.error('Save route error:', err);
          Alert.alert('Error', 'Failed to save route: ' + err.message);
        }
      },
      'plain-text'
    );
  };

  // Test AsyncStorage functionality
  const testStorage = async () => {
    try {
      await AsyncStorage.setItem('test_key', 'test_value');
      const value = await AsyncStorage.getItem('test_key');
      Alert.alert('Storage Test', value === 'test_value' ? 'Success!' : 'Failed');
    } catch (error) {
      Alert.alert('Storage Test Failed', error.message);
    }
  };

  // Get marker icon based on place type
  const getMarkerColor = (types) => {
    if (types.includes('gas_station')) return 'green';
    if (types.includes('restaurant')) return 'orange';
    if (types.includes('rest_area')) return 'blue';
    return 'red'; // default
  };

  return (
    <SafeAreaView style={styles.container}>
      <MapView
        ref={mapRef}
        style={{ width, height: height * 0.5 }}
        initialRegion={{
          latitude: 37.7749,
          longitude: -122.4194,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1
        }}
      >
        {routeCoords.length > 0 && (
          <>
            <Polyline coordinates={routeCoords} strokeWidth={4} strokeColor="#2196F3" />
            <Marker 
              coordinate={routeCoords[0]} 
              title="Origin"
              pinColor="green"
            />
            <Marker 
              coordinate={routeCoords[routeCoords.length - 1]} 
              title="Destination"
              pinColor="red"
            />
          </>
        )}

        {showRestStops && restStops.map(stop => (
          <Marker
            key={stop.id}
            coordinate={stop.location}
            title={stop.name}
            pinColor={getMarkerColor(stop.types)}
          >
            <Callout>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{stop.name}</Text>
                <Text>{stop.address}</Text>
                {stop.rating && <Text>Rating: {stop.rating} ⭐</Text>}
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      <View style={styles.controls}>
        <TextInput
          style={styles.input}
          placeholder="Origin"
          value={originQuery}
          onChangeText={setOriginQuery}
        />
        <TextInput
          style={styles.input}
          placeholder="Destination"
          value={destinationQuery}
          onChangeText={setDestinationQuery}
        />
        <Button title="Get Route" onPress={getRoute} />
      </View>

      <View style={styles.toggleContainer}>
        <Text>Show Rest Stops</Text>
        <Switch
          value={showRestStops}
          onValueChange={setShowRestStops}
          disabled={routeCoords.length === 0 || isLoadingRestStops}
        />
        {isLoadingRestStops && <Text style={styles.loading}>Loading...</Text>}
      </View>

      <View style={styles.buttonRow}>
        <Button title="Save Route" onPress={saveRoute} />
        <Button title="View Saved Routes" onPress={() => navigation.navigate('Routes')} />
        <Button title="Test Storage" onPress={testStorage} />
      </View>

      {showRestStops && restStops.length > 0 && (
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>Legend:</Text>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, {backgroundColor: 'green'}]} />
            <Text>Gas Stations</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, {backgroundColor: 'orange'}]} />
            <Text>Restaurants</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, {backgroundColor: 'blue'}]} />
            <Text>Rest Areas</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#f0f0f0' 
  },
  controls: { 
    flexDirection: 'row', 
    padding: 8, 
    alignItems: 'center' 
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 8,
    marginRight: 8,
    backgroundColor: '#fff'
  },
  buttonRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-around', 
    padding: 8 
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8
  },
  loading: {
    marginLeft: 8,
    color: '#666'
  },
  callout: {
    width: 150,
    padding: 5
  },
  calloutTitle: {
    fontWeight: 'bold',
    marginBottom: 3
  },
  legend: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: 8,
    margin: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd'
  },
  legendTitle: {
    fontWeight: 'bold',
    marginBottom: 4
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 6
  }
});

export default MapScreen;