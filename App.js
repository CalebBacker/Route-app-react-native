import React, { useState, useEffect, useCallback } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import MapScreen from './MapScreen';
import RoutesScreen from './RoutesScreen';

// Storage key - must match in all files
const ROUTES_STORAGE_KEY = 'saved_routes';

const Stack = createStackNavigator();

export default function App() {
  const [savedRoutes, setSavedRoutes] = useState([]);

  // Load routes from AsyncStorage
  const loadRoutes = useCallback(async () => {
    try {
      const storedRoutes = await AsyncStorage.getItem(ROUTES_STORAGE_KEY);
      if (storedRoutes) {
        const routes = JSON.parse(storedRoutes);
        console.log('App: Loaded', routes.length, 'routes from storage');
        setSavedRoutes(routes);
      } else {
        console.log('App: No routes found in storage');
        setSavedRoutes([]);
      }
    } catch (err) {
      console.warn('loadRoutes error', err);
      setSavedRoutes([]);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Map">
        <Stack.Screen name="Map">
          {props => (
            <MapScreen
              {...props}
              loadRoutes={loadRoutes}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="Routes" component={RoutesScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}





