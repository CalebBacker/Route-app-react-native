import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  TextInput,
  StyleSheet,
  SafeAreaView,
  useWindowDimensions,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal
} from 'react-native';
import MapView, { Marker, Polyline, Callout } from 'react-native-maps';
import polyline from '@mapbox/polyline';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage key
const ROUTES_STORAGE_KEY = 'saved_routes';
// Google API Key
const GOOGLE_API_KEY = 'AIzaSyDc-ESEi6f0JZwOGXdOy_NVeVH1kfpS1UI';

// Define place types we're interested in with more specific types
const PLACE_TYPES = [
  'gas_station', 
  'restaurant', 
  'rest_area', 
  'lodging',
  'parking',
  'convenience_store', 
  'cafe',
  'tourist_attraction',
  'campground'
].join('|');

function MapScreen({ navigation, route, loadRoutes }) {
  const [originQuery, setOriginQuery] = useState('');
  const [destinationQuery, setDestinationQuery] = useState('');
  const [routeCoords, setRouteCoords] = useState([]);
  const [showRestStops, setShowRestStops] = useState(false);
  const [restStops, setRestStops] = useState([]);
  const [isLoadingRestStops, setIsLoadingRestStops] = useState(false);
  const { width, height } = useWindowDimensions();
  const mapRef = useRef(null);
  const [promptVisible, setPromptVisible] = useState(false);
  const [routeName, setRouteName] = useState('');
  
  // Add refs to manage API requests and component mounting state
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef(null);
  
  // Clean up on component unmount
  useEffect(() => {
    isMountedRef.current = true;
    
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

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

  // Function to fetch rest stops data safely
  const fetchRestStops = async () => {
    if (routeCoords.length === 0) {
      Alert.alert('Error', 'Please generate a route first');
      setShowRestStops(false);
      return;
    }
    
    // Cancel any existing requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create a new abort controller
    abortControllerRef.current = new AbortController();
    
    setIsLoadingRestStops(true);
    
    try {
      // Use five points along the route for better coverage
      const numPoints = Math.min(5, routeCoords.length);
      const pointIndices = [];
      
      // Calculate evenly spaced indices along the route
      for (let i = 0; i < numPoints; i++) {
        const index = Math.floor(i * (routeCoords.length - 1) / (numPoints - 1));
        pointIndices.push(index);
      }
      
      const searchPoints = pointIndices.map(index => routeCoords[index]);
      
      let allRestStops = [];
      const uniquePlaceIds = new Set();
      
      // Use custom keywords for better rest area detection
      const keywords = [
        'rest area', 
        'rest stop', 
        'truck stop',
        'travel plaza',
        'service area',
        'welcome center'
      ];
      
      // Make API calls for each search point
      const searchPromises = [];
      
      // First search for place types
      for (const point of searchPoints) {
        const { latitude, longitude } = point;
        const typePromise = fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=10000&type=${PLACE_TYPES}&key=${GOOGLE_API_KEY}`, { 
          signal: abortControllerRef.current.signal 
        })
        .then(response => {
          if (!response.ok) {
            console.warn('Failed to get response from Places API:', response.status);
            return [];
          }
          return response.json();
        })
        .then(data => {
          if (data.status === 'OK' && data.results) {
            return data.results;
          }
          return [];
        })
        .catch(error => {
          if (error.name === 'AbortError') {
            console.log('Request was aborted');
          } else {
            console.error('Error searching for places by type:', error);
          }
          return [];
        });
        
        searchPromises.push(typePromise);
      }
      
      // Then search using keywords for rest areas
      for (const keyword of keywords) {
        for (const point of searchPoints) {
          const { latitude, longitude } = point;
          const keywordPromise = fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=20000&keyword=${encodeURIComponent(keyword)}&key=${GOOGLE_API_KEY}`, { 
            signal: abortControllerRef.current.signal 
          })
          .then(response => {
            if (!response.ok) {
              return [];
            }
            return response.json();
          })
          .then(data => {
            if (data.status === 'OK' && data.results) {
              return data.results;
            }
            return [];
          })
          .catch(error => {
            if (error.name !== 'AbortError') {
              console.error('Error searching for places by keyword:', error);
            }
            return [];
          });
          
          searchPromises.push(keywordPromise);
        }
      }
      
      // Wait for all promises to resolve
      const results = await Promise.all(searchPromises);
      
      // Combine and deduplicate results
      for (const places of results) {
        for (const place of places) {
          if (!uniquePlaceIds.has(place.place_id)) {
            uniquePlaceIds.add(place.place_id);
            
            // For debugging
            console.log(`Found place: ${place.name}, types:`, place.types ? place.types.join(',') : 'none');
            
            allRestStops.push({
              id: place.place_id,
              name: place.name,
              location: {
                latitude: place.geometry.location.lat,
                longitude: place.geometry.location.lng
              },
              address: place.vicinity,
              types: Array.isArray(place.types) ? place.types : [],
              rating: place.rating
            });
          }
        }
      }
      
      // Check if component is still mounted before updating state
      if (isMountedRef.current) {
        setRestStops(allRestStops);
        console.log(`Found ${allRestStops.length} rest stops`);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Error fetching rest stops:', error);
        // Only alert if still mounted
        if (isMountedRef.current) {
          Alert.alert('Error', 'Failed to find rest stops');
        }
      }
    } finally {
      // Make sure we only update state if component is still mounted
      if (isMountedRef.current) {
        setIsLoadingRestStops(false);
      }
    }
  };

  // Handle the toggle press safely
  const toggleRestStops = () => {
    const newValue = !showRestStops;
    
    // Update the UI state immediately
    setShowRestStops(newValue);
    
    // If turning off, abort any ongoing fetch and clear data
    if (!newValue) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setIsLoadingRestStops(false);
      // Don't clear restStops immediately to avoid UI flicker
      return;
    }
    
    // If turning on, fetch rest stops data
    if (newValue && routeCoords.length > 0) {
      // Clear previous rest stops before starting new fetch
      setRestStops([]);
      fetchRestStops();
    }
  };

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
  
  // Show our custom prompt modal
  setRouteName('');
  setPromptVisible(true);
};

// Handle save after user enters name in our custom prompt
const handleSaveWithName = async () => {
  setPromptVisible(false);
  
  if (!routeName?.trim()) {
    Alert.alert('Error', 'Route name cannot be empty.');
    return;
  }
  
  try {
    console.log('Starting route save...');
    
    // Create new route object
    const newRoute = {
      name: routeName.trim(),
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
    const duplicateIndex = routes.findIndex(r => r.name === routeName.trim());
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
};

  // Improved marker color detection
  const getMarkerColor = (types = [], name = '') => {
    if (!Array.isArray(types)) {
      types = [];
    }
    
    // Convert everything to lowercase for case-insensitive matching
    const typeStr = types.join(' ').toLowerCase();
    const nameStr = (name || '').toLowerCase();
    
    // Check for rest areas first in both name and types
    if (
      typeStr.includes('rest_area') || 
      nameStr.includes('rest area') || 
      nameStr.includes('rest stop') ||
      nameStr.includes('service area') ||
      nameStr.includes('travel plaza') ||
      nameStr.includes('welcome center')
    ) {
      return 'blue';
    }
    
    // Then check other types
    if (typeStr.includes('gas_station') || typeStr.includes('gas station')) {
      return 'green';
    }
    
    if (typeStr.includes('restaurant') || typeStr.includes('food') || typeStr.includes('cafe')) {
      return 'orange';
    }
    
    if (typeStr.includes('lodging') || typeStr.includes('hotel') || typeStr.includes('motel')) {
      return 'purple';
    }
    
    if (typeStr.includes('convenience') || typeStr.includes('store')) {
      return 'yellow';
    }
    
    // Default color for anything else
    return 'red';
  };

  // Format the place type for display - more user-friendly
  const formatPlaceType = (types = [], name = '') => {
    if (!Array.isArray(types) || types.length === 0) {
      // Try to infer type from name
      const nameStr = (name || '').toLowerCase();
      if (nameStr.includes('rest area') || nameStr.includes('rest stop')) {
        return 'Rest Area';
      }
      if (nameStr.includes('gas')) {
        return 'Gas Station';
      }
      return 'Location';
    }
    
    // Check for common types
    if (types.includes('rest_area')) return 'Rest Area';
    if (types.includes('gas_station')) return 'Gas Station';
    if (types.includes('restaurant')) return 'Restaurant';
    if (types.includes('cafe')) return 'Cafe';
    if (types.includes('lodging')) return 'Lodging';
    if (types.includes('convenience_store')) return 'Convenience Store';
    
    // Get the primary type
    const primaryType = types[0]?.replace(/_/g, ' ');
    return primaryType ? primaryType.charAt(0).toUpperCase() + primaryType.slice(1) : 'Location';
  };

  // Calculate map height (60% of screen height)
  const mapHeight = height * 0.6;
  
  // Calculate 1cm in pixels (approximately 38 pixels)
  const oneCmInPixels = 38;

  return (
    <SafeAreaView style={styles.container}>
     {/* Custom prompt modal */}
    <Modal
      visible={promptVisible}
      transparent={true}
      animationType="fade"
    >
      <View style={styles.modalOverlay}>
        <View style={styles.promptContainer}>
          <Text style={styles.promptTitle}>Save Route</Text>
          <Text style={styles.promptMessage}>Enter a name for this route:</Text>
          <TextInput
            style={styles.promptInput}
            value={routeName}
            onChangeText={setRouteName}
            autoFocus={true}
          />
          <View style={styles.promptButtons}>
            <TouchableOpacity 
              style={styles.promptButton} 
              onPress={() => setPromptVisible(false)}
            >
              <Text style={styles.promptButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.promptButton, styles.promptButtonConfirm]} 
              onPress={handleSaveWithName}
            >
              <Text style={[styles.promptButtonText, styles.promptButtonTextConfirm]}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal> 
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        <View style={styles.contentContainer}>
          {/* Fixed size map */}
          <View style={styles.mapContainer}>
            <MapView
              ref={mapRef}
              style={[styles.map, { height: mapHeight }]}
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

              {/* Only render markers when showRestStops is true */}
              {showRestStops && restStops.map(stop => (
                <Marker
                  key={stop.id}
                  coordinate={stop.location}
                  title={stop.name}
                  pinColor={getMarkerColor(stop.types, stop.name)}
                >
                  <Callout>
                    <View style={styles.callout}>
                      <Text style={styles.calloutTitle}>{stop.name}</Text>
                      <Text>{stop.address}</Text>
                      {stop.rating && <Text>Rating: {stop.rating} ⭐</Text>}
                      <Text style={styles.calloutType}>{formatPlaceType(stop.types, stop.name)}</Text>
                    </View>
                  </Callout>
                </Marker>
              ))}
            </MapView>
          </View>
          
          {/* Controls below the map - moved down by 1cm */}
          <View style={[styles.controlsContainer, { top: `calc(60% + ${oneCmInPixels}px)` }]}>
            {/* Card with all controls - positioned at bottom of map */}
            <View style={styles.card}>
              {/* Row with input fields */}
              <View style={styles.row}>
                <TextInput
                  style={styles.input}
                  placeholder="Origin"
                  value={originQuery}
                  onChangeText={setOriginQuery}
                  placeholderTextColor="#888"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Destination"
                  value={destinationQuery}
                  onChangeText={setDestinationQuery}
                  placeholderTextColor="#888"
                />
              </View>
              
              {/* Row with route button and toggle */}
              <View style={styles.row}>
                <TouchableOpacity 
                  style={styles.button}
                  onPress={getRoute}
                >
                  <Text style={styles.buttonText}>Get Route</Text>
                </TouchableOpacity>
                
                <View style={styles.toggleContainer}>
                  <Text style={styles.toggleLabel}>Rest Stops</Text>
                  <TouchableOpacity 
                    style={[
                      styles.customToggle, 
                      showRestStops ? styles.customToggleOn : styles.customToggleOff,
                      routeCoords.length === 0 || isLoadingRestStops ? styles.customToggleDisabled : null
                    ]}
                    onPress={toggleRestStops}
                    disabled={routeCoords.length === 0 || isLoadingRestStops}
                  >
                    <View style={[
                      styles.customToggleBall,
                      showRestStops ? styles.customToggleBallOn : styles.customToggleBallOff
                    ]} />
                  </TouchableOpacity>
                  {isLoadingRestStops && (
                    <ActivityIndicator size="small" color="#0000ff" style={styles.loading} />
                  )}
                </View>
              </View>
              
              {/* Row with save button and view saved button */}
              <View style={styles.row}>
                <TouchableOpacity 
                  style={[styles.button, styles.buttonSecondary]}
                  onPress={saveRoute}
                >
                  <Text style={styles.buttonText}>Save Route</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.button, styles.buttonSecondary]}
                  onPress={() => navigation.navigate('Routes')}
                >
                  <Text style={styles.buttonText}>View Saved Routes</Text>
                </TouchableOpacity>
              </View>
              
              {/* Legend row - only visible when rest stops are shown */}
              {showRestStops && (
                <View style={styles.legendContainer}>
                  <Text style={styles.legendTitle}>Legend:</Text>
                  <View style={styles.legendGrid}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, {backgroundColor: 'blue'}]} />
                      <Text style={styles.legendText}>Rest Areas</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, {backgroundColor: 'green'}]} />
                      <Text style={styles.legendText}>Gas</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, {backgroundColor: 'orange'}]} />
                      <Text style={styles.legendText}>Food</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, {backgroundColor: 'purple'}]} />
                      <Text style={styles.legendText}>Lodging</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, {backgroundColor: 'yellow'}]} />
                      <Text style={styles.legendText}>Stores</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, {backgroundColor: 'red'}]} />
                      <Text style={styles.legendText}>Other</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#f5f7fa'
  },
  keyboardAvoid: {
    flex: 1
  },
  contentContainer: {
    flex: 1,
    display: 'flex'
  },
  mapContainer: {
    // The map container has a fixed position
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1
  },
  map: {
    width: '100%',
    // Height is set dynamically based on screen size
  },
  controlsContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 8,
    zIndex: 2,
    // Dynamically adjust 'top' based on map height
    top: ({height}) => height * 0.6, // 60% of screen height for map
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8
  },
  input: {
    flex: 1,
    backgroundColor: '#f5f7fa',
    borderRadius: 6,
    padding: 10,
    marginHorizontal: 3,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#e1e5eb',
    height: 38
  },
  button: {
    flex: 1,
    backgroundColor: '#2196F3',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 3,
    height: 36
  },
  buttonSecondary: {
    backgroundColor: '#3a86ff',
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14
  },
  toggleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f7fa',
    borderRadius: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#e1e5eb',
    marginHorizontal: 3,
    height: 36
  },
  toggleLabel: {
    fontSize: 14,
    marginRight: 5,
    flex: 1
  },
  loading: {
    marginLeft: 4
  },
  callout: {
    width: 160,
    padding: 8
  },
  calloutTitle: {
    fontWeight: 'bold',
    marginBottom: 3,
    fontSize: 14
  },
  calloutType: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
    color: '#666'
  },
  legendContainer: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e1e5eb'
  },
  legendTitle: {
    fontWeight: 'bold',
    marginBottom: 6,
    fontSize: 14
  },
  legendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between'
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '33%',
    marginBottom: 6
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(0,0,0,0.1)'
  },
  legendText: {
    fontSize: 12
  },
  // Custom toggle styles
  customToggle: {
    width: 40,
    height: 22,
    borderRadius: 11,
    padding: 2,
    justifyContent: 'center'
  },
  customToggleOn: {
    backgroundColor: '#4CD964'
  },
  customToggleOff: {
    backgroundColor: '#D3D3D3'
  },
  customToggleDisabled: {
    opacity: 0.4
  },
  customToggleBall: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
    elevation: 1
  },
  customToggleBallOn: {
    alignSelf: 'flex-end'
  },
  customToggleBallOff: {
    alignSelf: 'flex-start'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  promptContainer: {
    width: '80%',
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  promptTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  promptMessage: {
    fontSize: 16,
    marginBottom: 15,
  },
  promptInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    padding: 10,
    fontSize: 16,
    marginBottom: 15,
  },
  promptButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  promptButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginLeft: 10,
  },
  promptButtonConfirm: {
    backgroundColor: '#2196F3',
    borderRadius: 5,
  },
  promptButtonText: {
    fontSize: 16,
  },
  promptButtonTextConfirm: {
    color: 'white',
  },
  
});

export default MapScreen;
