import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Button,
  Alert,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage key - must match the one in MapScreen
const ROUTES_STORAGE_KEY = 'saved_routes';

export default function RoutesScreen({ navigation }) {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch routes from AsyncStorage
  const fetchRoutes = async () => {
    setLoading(true);
    try {
      console.log('Fetching saved routes...');
      const storedRoutes = await AsyncStorage.getItem(ROUTES_STORAGE_KEY);
      console.log('Retrieved:', storedRoutes ? 'data found' : 'no data');
      
      if (storedRoutes) {
        const parsedRoutes = JSON.parse(storedRoutes);
        console.log('Found', parsedRoutes.length, 'routes');
        setRoutes(parsedRoutes);
      } else {
        console.log('No routes found in storage');
        setRoutes([]);
      }
    } catch (err) {
      console.error('Failed to load routes', err);
      Alert.alert('Error', 'Could not load saved routes: ' + err.message);
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch routes whenever screen comes into focus
  useFocusEffect(
    useCallback(() => {
      fetchRoutes();
    }, [])
  );

  // Delete a route
  const deleteRoute = (routeName) => {
    Alert.alert(
      'Delete Route',
      `Are you sure you want to delete "${routeName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            try {
              // Get current routes
              const storedRoutes = await AsyncStorage.getItem(ROUTES_STORAGE_KEY);
              if (!storedRoutes) return;
              
              // Filter out the route to delete
              const currentRoutes = JSON.parse(storedRoutes);
              const updatedRoutes = currentRoutes.filter(route => route.name !== routeName);
              
              // Save the updated routes
              await AsyncStorage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(updatedRoutes));
              Alert.alert('Success', 'Route deleted');
              fetchRoutes(); // Refresh list
            } catch (err) {
              console.error('Delete failed', err);
              Alert.alert('Error', 'Could not delete route: ' + err.message);
            }
          }
        }
      ]
    );
  };

  // Clear all routes
  const clearAllRoutes = () => {
    Alert.alert(
      'Clear All Routes',
      'Are you sure you want to delete all saved routes? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All', 
          style: 'destructive', 
          onPress: async () => {
            try {
              await AsyncStorage.removeItem(ROUTES_STORAGE_KEY);
              Alert.alert('Success', 'All routes cleared');
              setRoutes([]);
            } catch (err) {
              console.error('Clear all failed', err);
              Alert.alert('Error', 'Could not clear routes: ' + err.message);
            }
          }
        }
      ]
    );
  };

  // Render each route item
  const renderItem = ({ item }) => (
    <View style={styles.item}>
      <TouchableOpacity
        style={styles.routeInfo}
        onPress={() => navigation.navigate('Map', { selectedRoute: item })}
      >
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.detail}>{item.origin} → {item.destination}</Text>
      </TouchableOpacity>
      <Button 
        title="Delete" 
        color="#d00" 
        onPress={() => deleteRoute(item.name)} 
      />
    </View>
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" style={styles.loading} />
      ) : (
        <>
          <View style={styles.headerButtons}>
            <Button title="Refresh" onPress={fetchRoutes} />
            {routes.length > 0 && (
              <Button title="Clear All" color="#d00" onPress={clearAllRoutes} />
            )}
          </View>
          
          <FlatList
            data={routes}
            keyExtractor={(item, index) => item.name + index}
            renderItem={renderItem}
            ListEmptyComponent={
              <Text style={styles.empty}>No saved routes</Text>
            }
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    padding: 16, 
    backgroundColor: '#f9f9f9' 
  },
  headerButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#eee'
  },
  routeInfo: {
    flex: 1,
    padding: 8
  },
  name: {
    fontSize: 16,
    fontWeight: 'bold'
  },
  detail: {
    fontSize: 14,
    color: '#666',
    marginTop: 4
  },
  empty: {
    textAlign: 'center',
    marginTop: 40,
    fontStyle: 'italic',
    color: '#666'
  },
  loading: {
    marginTop: 40
  }
});